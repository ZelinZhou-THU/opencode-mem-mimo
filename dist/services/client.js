import { embeddingService } from "./embedding.js";
import { shardManager } from "./sqlite/shard-manager.js";
import { vectorSearch } from "./sqlite/vector-search.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { searchFts } from "./sqlite/fts-search.js";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import { reconcileMarkdown } from "./markdown-memory.js";
let lastReconcileAt = 0;
function safeToISOString(timestamp) {
    try {
        if (timestamp === null || timestamp === undefined) {
            return new Date().toISOString();
        }
        const numValue = Number(timestamp);
        if (isNaN(numValue) || numValue < 0) {
            return new Date().toISOString();
        }
        return new Date(numValue).toISOString();
    }
    catch {
        return new Date().toISOString();
    }
}
function safeJSONParse(jsonString) {
    if (!jsonString || typeof jsonString !== "string") {
        return undefined;
    }
    try {
        return JSON.parse(jsonString);
    }
    catch {
        return undefined;
    }
}
function toBlob(vector) {
    return vector ? new Uint8Array(vector.buffer) : null;
}
function extractScopeFromContainerTag(containerTag) {
    const parts = containerTag.split("_");
    if (parts.length >= 3) {
        const scope = parts[1];
        if (scope === "user" || scope === "project") {
            const hash = parts.slice(2).join("_");
            return { scope, hash };
        }
    }
    return { scope: "user", hash: containerTag };
}
function resolveScopeValue(scope, containerTag) {
    if (scope === "all-projects") {
        return { scope: "project", hash: "" };
    }
    return extractScopeFromContainerTag(containerTag);
}
export class LocalMemoryClient {
    initPromise = null;
    isInitialized = false;
    constructor() { }
    async initialize() {
        if (this.isInitialized)
            return;
        if (this.initPromise)
            return this.initPromise;
        this.initPromise = (async () => {
            try {
                this.isInitialized = true;
            }
            catch (error) {
                this.initPromise = null;
                log("SQLite initialization failed", { error: String(error) });
                throw error;
            }
        })();
        return this.initPromise;
    }
    async warmup(progressCallback) {
        await this.initialize();
        await embeddingService.warmup(progressCallback);
    }
    async isReady() {
        return this.isInitialized && embeddingService.isWarmedUp;
    }
    getStatus() {
        return {
            dbConnected: this.isInitialized,
            modelLoaded: embeddingService.isWarmedUp,
            ready: this.isInitialized && embeddingService.isWarmedUp,
        };
    }
    close() {
        connectionManager.closeAll();
    }
    async searchMemories(query, containerTag, scope = "project") {
        try {
            await this.initialize();
            if (CONFIG.markdown?.syncOnSearch) {
                try {
                    if (Date.now() - lastReconcileAt > 30_000) {
                        lastReconcileAt = Date.now();
                        await reconcileMarkdown(undefined, containerTag);
                    }
                }
                catch (error) {
                    log("Markdown reconcile skipped", { error: String(error) });
                }
            }
            const queryVector = await embeddingService.embedWithTimeout(query);
            const resolved = resolveScopeValue(scope, containerTag);
            const shards = shardManager.getAllShards(resolved.scope, resolved.hash);
            if (shards.length === 0) {
                return { success: true, results: [], total: 0, timing: 0 };
            }
            const tagFilter = scope === "all-projects" ? "" : containerTag;
            const [vectorResults, ftsResults] = await Promise.all([
                vectorSearch.searchAcrossShards(shards, queryVector, tagFilter, CONFIG.maxMemories, 0, query),
                (async () => {
                    const fts = [];
                    for (const shard of shards) {
                        try {
                            const db = connectionManager.getConnection(shard.dbPath);
                            fts.push(...searchFts(db, query, tagFilter, CONFIG.maxMemories));
                        }
                        catch (error) {
                            log("FTS search failed for shard", { shardId: shard.id, error: String(error) });
                        }
                    }
                    return fts;
                })(),
            ]);
            const fusedResults = fuseSearchResults(vectorResults, ftsResults);
            return { success: true, results: fusedResults, total: fusedResults.length, timing: 0 };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log("searchMemories: error", { error: errorMessage });
            return { success: false, error: errorMessage, results: [], total: 0, timing: 0 };
        }
    }
    async addMemory(content, containerTag, metadata) {
        try {
            await this.initialize();
            const tags = metadata?.tags || [];
            const vector = await embeddingService.embedWithTimeout(content);
            let tagsVector = undefined;
            if (tags.length > 0) {
                // Wrap tags in a natural-language template before embedding. Bare comma
                // lists like "react, auth, bug-fix" sit outside the multilingual-e5
                // training distribution, so the resulting tagsVector drifts toward
                // unrelated chatter and weakens the 0.4-weight tag boost in
                // VectorSearch#searchInShard. The "Topics: ..." prefix is a sentence
                // form e5 was trained on and yields a more discriminative vector.
                tagsVector = await embeddingService.embedWithTimeout(`Topics: ${tags.join(", ")}`);
            }
            const { scope, hash } = extractScopeFromContainerTag(containerTag);
            const shard = shardManager.getWriteShard(scope, hash);
            const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            const now = Date.now();
            const { displayName, userName, userEmail, projectPath, projectName, gitRepoUrl, type, tags: _tags, ...dynamicMetadata } = metadata || {};
            const record = {
                id,
                content,
                vector,
                tagsVector,
                containerTag,
                tags: tags.length > 0 ? tags.join(",") : undefined,
                type,
                createdAt: now,
                updatedAt: now,
                displayName,
                userName,
                userEmail,
                projectPath,
                projectName,
                gitRepoUrl,
                metadata: Object.keys(dynamicMetadata).length > 0 ? JSON.stringify(dynamicMetadata) : undefined,
            };
            const db = connectionManager.getConnection(shard.dbPath);
            // Use transaction for atomic SQLite insert
            const insertMemory = db.transaction(() => {
                const insertStmt = db.prepare(`
          INSERT INTO memories (
            id, content, vector, tags_vector, container_tag, tags, type, created_at, updated_at,
            metadata, display_name, user_name, user_email, project_path, project_name, git_repo_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
                insertStmt.run(record.id, record.content, toBlob(record.vector), toBlob(record.tagsVector), record.containerTag, record.tags || null, record.type || null, record.createdAt, record.updatedAt, record.metadata || null, record.displayName || null, record.userName || null, record.userEmail || null, record.projectPath || null, record.projectName || null, record.gitRepoUrl || null);
            });
            insertMemory();
            // Vector index update (outside transaction — vector backend is async/in-memory)
            try {
                const backend = await vectorSearch.getBackend();
                if (record.tagsVector) {
                    await backend.insert({ id: record.id, vector: record.tagsVector, shard, kind: "tags" });
                }
                await backend.insert({ id: record.id, vector: record.vector, shard, kind: "content" });
            }
            catch (error) {
                // Rollback SQLite insert and any partial vector inserts on backend failure
                try {
                    const backend = await vectorSearch.getBackend();
                    if (record.tagsVector) {
                        await backend.delete({ id: record.id, shard, kind: "tags" }).catch(() => { });
                    }
                    await backend.delete({ id: record.id, shard, kind: "content" }).catch(() => { });
                }
                catch { }
                db.prepare(`DELETE FROM memories WHERE id = ?`).run(record.id);
                throw error;
            }
            shardManager.incrementVectorCount(shard.id);
            return { success: true, id };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log("addMemory: error", { error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }
    async deleteMemory(memoryId) {
        try {
            await this.initialize();
            const userShards = shardManager.getAllShards("user", "");
            const projectShards = shardManager.getAllShards("project", "");
            const allShards = [...userShards, ...projectShards];
            for (const shard of allShards) {
                const db = connectionManager.getConnection(shard.dbPath);
                const memory = vectorSearch.getMemoryById(db, memoryId);
                if (memory) {
                    await vectorSearch.deleteVector(db, memoryId, shard);
                    try {
                        db.prepare(`DELETE FROM markdown_sync WHERE memory_id = ?`).run(memoryId);
                    }
                    catch (syncError) {
                        log("deleteMemory: markdown_sync cleanup failed", { memoryId, error: String(syncError) });
                    }
                    shardManager.decrementVectorCount(shard.id);
                    return { success: true };
                }
            }
            return { success: false, error: "Memory not found" };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log("deleteMemory: error", { memoryId, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }
    async listMemories(containerTag, limit = 20, scope = "project") {
        try {
            await this.initialize();
            const resolved = resolveScopeValue(scope, containerTag);
            const shards = shardManager.getAllShards(resolved.scope, resolved.hash);
            if (shards.length === 0) {
                return {
                    success: true,
                    memories: [],
                    pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
                };
            }
            const allMemories = [];
            for (const shard of shards) {
                const db = connectionManager.getConnection(shard.dbPath);
                const memories = vectorSearch.listMemories(db, scope === "all-projects" ? "" : containerTag, limit);
                allMemories.push(...memories);
            }
            allMemories.sort((a, b) => Number(b.created_at) - Number(a.created_at));
            const memories = allMemories.slice(0, limit).map((r) => ({
                id: r.id,
                summary: r.content,
                createdAt: safeToISOString(r.created_at),
                metadata: safeJSONParse(r.metadata),
                displayName: r.display_name,
                userName: r.user_name,
                userEmail: r.user_email,
                projectPath: r.project_path,
                projectName: r.project_name,
                gitRepoUrl: r.git_repo_url,
            }));
            return {
                success: true,
                memories,
                pagination: { currentPage: 1, totalItems: memories.length, totalPages: 1 },
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log("listMemories: error", { error: errorMessage });
            return {
                success: false,
                error: errorMessage,
                memories: [],
                pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
            };
        }
    }
    async searchMemoriesBySessionID(sessionID, containerTag, limit = 10) {
        try {
            await this.initialize();
            const { scope, hash } = extractScopeFromContainerTag(containerTag);
            const shards = shardManager.getAllShards(scope, hash);
            if (shards.length === 0) {
                return { success: true, results: [], total: 0, timing: 0 };
            }
            const allMemories = [];
            for (const shard of shards) {
                const db = connectionManager.getConnection(shard.dbPath);
                const memories = vectorSearch.getMemoriesBySessionID(db, sessionID);
                allMemories.push(...memories);
            }
            allMemories.sort((a, b) => Number(b.created_at) - Number(a.created_at));
            const results = allMemories.slice(0, limit).map((row) => ({
                id: row.id,
                memory: row.content,
                similarity: 1.0,
                tags: row.tags || [],
                metadata: row.metadata || {},
                containerTag: row.container_tag,
                displayName: row.display_name,
                userName: row.user_name,
                userEmail: row.user_email,
                projectPath: row.project_path,
                projectName: row.project_name,
                gitRepoUrl: row.git_repo_url,
                createdAt: row.created_at,
            }));
            return { success: true, results, total: results.length, timing: 0 };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log("searchMemoriesBySessionID: error", { error: errorMessage });
            return { success: false, error: errorMessage, results: [], total: 0, timing: 0 };
        }
    }
}
export const memoryClient = new LocalMemoryClient();
function fuseSearchResults(vectorResults, ftsResults) {
    if (ftsResults.length === 0)
        return vectorResults;
    const rawMax = ftsResults.reduce((mx, r) => Math.max(mx, r.bm25Score), 0);
    const maxFts = rawMax > 0 ? rawMax : 1;
    const normalizedFts = new Map();
    for (const r of ftsResults) {
        normalizedFts.set(r.id, r.bm25Score / maxFts);
    }
    const map = new Map();
    for (const r of vectorResults) {
        map.set(r.id, { ...r, vectorScore: r.similarity, ftsScore: normalizedFts.get(r.id) || 0 });
    }
    for (const r of ftsResults) {
        if (!map.has(r.id)) {
            map.set(r.id, {
                id: r.id,
                memory: r.content,
                vectorScore: 0,
                ftsScore: normalizedFts.get(r.id) || 0,
                tags: [],
                metadata: {},
            });
        }
    }
    return Array.from(map.values())
        .map((r) => {
        const blended = r.vectorScore * 0.6 + r.ftsScore * 0.4;
        return {
            ...r,
            similarity: r.ftsScore > 0
                ? Math.max(r.vectorScore, blended)
                : r.vectorScore,
        };
    })
        .filter((r) => r.similarity > 0)
        .sort((a, b) => b.similarity - a.similarity);
}
