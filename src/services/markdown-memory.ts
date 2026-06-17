import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, appendFileSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { homedir } from "node:os";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import { connectionManager } from "./sqlite/connection-manager.js";
import { embeddingService } from "./embedding.js";
import { shardManager } from "./sqlite/shard-manager.js";
import { vectorSearch } from "./sqlite/vector-search.js";

const GLOBAL_MEMORY_DIR = join(homedir(), ".opencode-mem", "global");

let _projectDirectory: string | null = null;

export function setProjectDirectory(directory: string): void {
  _projectDirectory = directory;
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getProjectMemoryPath(projectDir: string): string {
  return join(projectDir, ".opencode", "MEMORY.md");
}

export function getGlobalMemoryPath(): string {
  return join(GLOBAL_MEMORY_DIR, "MEMORY.md");
}

export function readMemoryFile(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    log("readMemoryFile error", { path, error: String(error) });
    return "";
  }
}

export function writeMemoryFile(path: string, content: string): void {
  ensureDir(path);
  writeFileSync(path, content, "utf-8");
}

export const MEMORY_TEMPLATE = `# Project Memory

## Rules
_Project-level rules explicitly stated by the user._

## Architecture Decisions
_Decision + date + rationale._

## Discovered Knowledge
_Cross-session durable facts._

## Patterns
_Repeated problems and solutions._

## Gotchas
_Easy-to-miss traps._
`;

interface MarkdownSyncRow {
  path: string;
  fingerprint: string;
  memory_id: string;
  container_tag: string;
  indexed_at: number;
}

function computeFingerprint(filePath: string): string | null {
  try {
    const stat = statSync(filePath);
    return `${stat.size}-${stat.mtimeMs}`;
  } catch (error) {
    log("computeFingerprint error", { filePath, error: String(error) });
    return null;
  }
}

function getSyncRecord(db: any, path: string): MarkdownSyncRow | null {
  try {
    return (db.prepare("SELECT * FROM markdown_sync WHERE path = ?").get(path) as MarkdownSyncRow) || null;
  } catch (error) {
    log("getSyncRecord error", { path, error: String(error) });
    return null;
  }
}

function upsertSyncRecord(db: any, row: MarkdownSyncRow): void {
  db.prepare(
    `INSERT INTO markdown_sync (path, fingerprint, memory_id, container_tag, indexed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       fingerprint = excluded.fingerprint,
       memory_id = excluded.memory_id,
       container_tag = excluded.container_tag,
       indexed_at = excluded.indexed_at`
  ).run(row.path, row.fingerprint, row.memory_id, row.container_tag, row.indexed_at);
}

function deleteSyncRecord(db: any, path: string): void {
  db.prepare("DELETE FROM markdown_sync WHERE path = ?").run(path);
}

async function indexMarkdownFile(
  filePath: string,
  containerTag: string,
  scope: "user" | "project"
): Promise<{ indexed: boolean; memoryId?: string }> {
  const fingerprint = computeFingerprint(filePath);
  if (!fingerprint) return { indexed: false };

  const shard = shardManager.getWriteShard(scope, scope === "user" ? "" : containerTag.split("_").slice(2).join("_"));
  const db = connectionManager.getConnection(shard.dbPath);

  const existing = getSyncRecord(db, filePath);

  if (existing && existing.fingerprint === fingerprint) {
    return { indexed: false };
  }

  const content = readMemoryFile(filePath);
  if (!content.trim()) {
    if (existing) {
      try {
        await vectorSearch.deleteVector(db, existing.memory_id, shard);
      } catch (error) {
        log("deleteVector failed during markdown re-index (empty)", { filePath, error: String(error) });
      }
      deleteSyncRecord(db, filePath);
    }
    return { indexed: false };
  }

  const id = `md_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = Date.now();
  let vector: Float32Array;
  try {
    vector = await embeddingService.embedWithTimeout(content);
  } catch (error) {
    log("Embedding failed during markdown re-index, old memory preserved", { filePath, error: String(error) });
    throw error;
  }

  if (existing) {
    try {
      await vectorSearch.deleteVector(db, existing.memory_id, shard);
    } catch (error) {
      log("deleteVector failed during markdown re-index (update)", { filePath, error: String(error) });
    }
    deleteSyncRecord(db, filePath);
  }

  const insertTransaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO memories (
        id, content, vector, tags_vector, container_tag, tags, type, created_at, updated_at,
        metadata, display_name, user_name, user_email, project_path, project_name, git_repo_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      content,
      new Uint8Array(vector.buffer),
      null,
      containerTag,
      "MEMORY.md,markdown",
      "markdown",
      now,
      now,
      JSON.stringify({ source: "markdown-sync", path: filePath }),
      null,
      null,
      null,
      null,
      null,
      null
    );

    upsertSyncRecord(db, {
      path: filePath,
      fingerprint,
      memory_id: id,
      container_tag: containerTag,
      indexed_at: now,
    });
  });

  insertTransaction();

  try {
    const backend = await (vectorSearch as any).getBackend();
    await backend.insert({ id, vector, shard, kind: "content" });
  } catch (error) {
    db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    deleteSyncRecord(db, filePath);
    throw error;
  }

  shardManager.incrementVectorCount(shard.id);

  return { indexed: true, memoryId: id };
}

async function pruneDeletedFile(
  db: any,
  filePath: string,
  shard: any
): Promise<void> {
  const existing = getSyncRecord(db, filePath);
  if (!existing) return;

  try {
    await vectorSearch.deleteVector(db, existing.memory_id, shard);
    shardManager.decrementVectorCount(shard.id);
    deleteSyncRecord(db, filePath);
  } catch (error) {
    log("pruneDeletedFile error", { filePath, error: String(error) });
  }
}

export interface ReconcileResult {
  indexed: number;
  pruned: number;
  skipped: number;
}

export async function reconcileMarkdown(
  directory?: string,
  containerTag?: string
): Promise<ReconcileResult> {
  if (!CONFIG.markdown?.enabled) {
    return { indexed: 0, pruned: 0, skipped: 0 };
  }

  const dir = directory || _projectDirectory || process.cwd();
  const tag = containerTag || `${CONFIG.containerTagPrefix}_project_unknown`;

  const result: ReconcileResult = { indexed: 0, pruned: 0, skipped: 0 };

  const targets: { path: string; scope: "user" | "project"; tag: string }[] = [
    { path: getProjectMemoryPath(dir), scope: "project", tag },
    { path: getGlobalMemoryPath(), scope: "user", tag: `${CONFIG.containerTagPrefix}_user_global` },
  ];

  for (const target of targets) {
    try {
      if (!existsSync(target.path)) {
        const shards = shardManager.getAllShards(target.scope, target.scope === "user" ? "" : target.tag.split("_").slice(2).join("_"));
        for (const shard of shards) {
          const db = connectionManager.getConnection(shard.dbPath);
          await pruneDeletedFile(db, target.path, shard);
        }
        continue;
      }

      const { indexed, memoryId } = await indexMarkdownFile(target.path, target.tag, target.scope);
      if (indexed) {
        result.indexed++;
        log("Markdown reconciled", { path: target.path, memoryId });
      } else {
        result.skipped++;
      }
    } catch (error) {
      log("Markdown reconcile error", { path: target.path, error: String(error) });
    }
  }

  return result;
}

export async function appendToNotes(
  directory: string,
  content: string,
  metadata?: { source?: string; timestamp?: number }
): Promise<void> {
  if (!CONFIG.markdown?.autoWrite) return;

  const notesPath = join(directory, ".opencode", "notes.md");
  const ts = metadata?.timestamp || Date.now();
  const source = metadata?.source || "auto-capture";
  const entry = `\n## ${new Date(ts).toISOString()} [${source}]\n${content}\n`;

  ensureDir(notesPath);
  appendFileSync(notesPath, entry, "utf-8");
}
