import { buildFtsQuery } from "./fts-query.js";
import { log } from "../logger.js";

export interface FtsSearchResult {
  id: string;
  content: string;
  snippet: string;
  bm25Score: number;
}

export function initFts(db: any): void {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, tags, type,
        content='memories',
        content_rowid='rowid',
        tokenize='trigram'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, tags, type)
        VALUES (new.rowid, new.content, COALESCE(new.tags,''), COALESCE(new.type,''));
      END;
      CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags, type)
        VALUES ('delete', old.rowid, old.content, COALESCE(old.tags,''), COALESCE(old.type,''));
      END;
      CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags, type)
        VALUES ('delete', old.rowid, old.content, COALESCE(old.tags,''), COALESCE(old.type,''));
        INSERT INTO memories_fts(rowid, content, tags, type)
        VALUES (new.rowid, new.content, COALESCE(new.tags,''), COALESCE(new.type,''));
      END;
    `);
  } catch (error) {
    console.error("[opencode-mem] FTS5 init failed:", error);
  }
}

export function rebuildFtsIndex(db: any): void {
  try {
    db.exec(`INSERT INTO memories_fts(memories_fts) VALUES('rebuild');`);
  } catch (error) {
    log("FTS5 index rebuild failed", { error: String(error) });
  }
}

export function searchFts(
  db: any,
  query: string,
  containerTag: string,
  limit: number
): FtsSearchResult[] {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  try {
    const sql =
      containerTag === ""
        ? `SELECT m.id, m.content,
                  snippet(memories_fts, 0, '<<', '>>', '...', 32) as snippet,
                  bm25(memories_fts) as rank
           FROM memories_fts
           JOIN memories m ON m.rowid = memories_fts.rowid
           WHERE memories_fts MATCH ?
           ORDER BY rank
           LIMIT ?`
        : `SELECT m.id, m.content,
                  snippet(memories_fts, 0, '<<', '>>', '...', 32) as snippet,
                  bm25(memories_fts) as rank
           FROM memories_fts
           JOIN memories m ON m.rowid = memories_fts.rowid
           WHERE memories_fts MATCH ? AND m.container_tag = ?
           ORDER BY rank
           LIMIT ?`;

    const rows =
      containerTag === ""
        ? (db.prepare(sql).all(ftsQuery, limit * 3) as any[])
        : (db.prepare(sql).all(ftsQuery, containerTag, limit * 3) as any[]);

    if (rows.length === 0) return [];

    const results: FtsSearchResult[] = rows.map((r) => ({
      id: r.id,
      content: r.content,
      snippet: r.snippet,
      bm25Score: -r.rank,
    }));

    const topScore = results[0]?.bm25Score ?? 0;
    const floor = topScore * 0.15;
    return results.filter((r) => r.bm25Score >= floor).slice(0, limit);
  } catch (error) {
    log("searchFts error", { query, error: String(error) });
    return [];
  }
}
