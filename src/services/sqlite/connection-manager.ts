import { getDatabase } from "./sqlite-bootstrap.js";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../logger.js";
import { initFts, rebuildFtsIndex } from "./fts-search.js";

const Database = getDatabase();

export class ConnectionManager {
  private connections: Map<string, typeof Database.prototype> = new Map();

  private initDatabase(db: typeof Database.prototype): void {
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA cache_size = -64000");
    db.run("PRAGMA temp_store = MEMORY");
    db.run("PRAGMA foreign_keys = ON");

    this.migrateSchema(db);

    try {
      const hasMemories = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'")
        .get();
      if (hasMemories) {
        this.initShardExtras(db);
      }
    } catch (error) {
      log("Shard extras init error", { error: String(error) });
    }
  }

  private initShardExtras(db: typeof Database.prototype): void {
    try {
      db.run(`
        CREATE TABLE IF NOT EXISTS markdown_sync (
          path TEXT PRIMARY KEY,
          fingerprint TEXT NOT NULL,
          memory_id TEXT NOT NULL,
          container_tag TEXT NOT NULL,
          indexed_at INTEGER NOT NULL
        )
      `);
    } catch (error) {
      log("markdown_sync table creation error", { error: String(error) });
    }

    try {
      initFts(db);
      const count = (db.prepare("SELECT COUNT(*) as c FROM memories").get() as any)?.c ?? 0;
      const ftsCount = (db.prepare("SELECT COUNT(*) as c FROM memories_fts").get() as any)?.c ?? 0;
      if (count > 0 && ftsCount === 0) {
        rebuildFtsIndex(db);
        log("FTS5 index rebuilt for existing memories", { count });
      }
    } catch (error) {
      log("FTS5 init error", { error: String(error) });
    }
  }

  private migrateSchema(db: typeof Database.prototype): void {
    try {
      const columns = db.prepare("PRAGMA table_info(memories)").all() as any[];
      const hasTags = columns.some((c) => c.name === "tags");

      if (!hasTags && columns.length > 0) {
        db.run("ALTER TABLE memories ADD COLUMN tags TEXT");
      }
    } catch (error) {
      log("Schema migration error", { error: String(error) });
    }
  }

  getConnection(dbPath: string): typeof Database.prototype {
    if (this.connections.has(dbPath)) {
      return this.connections.get(dbPath)!;
    }

    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const db = new Database(dbPath);
    this.initDatabase(db);
    this.connections.set(dbPath, db);

    return db;
  }

  closeConnection(dbPath: string): void {
    const db = this.connections.get(dbPath);
    if (db) {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
      this.connections.delete(dbPath);
    }
  }

  closeAll(): void {
    for (const [path, db] of this.connections) {
      try {
        db.run("PRAGMA wal_checkpoint(TRUNCATE)");
        db.close();
      } catch (error) {
        log("Error closing database", { path, error: String(error) });
      }
    }
    this.connections.clear();
  }

  checkpointAll(): void {
    for (const [path, db] of this.connections) {
      try {
        db.run("PRAGMA wal_checkpoint(PASSIVE)");
      } catch (error) {
        log("Error checkpointing database", { path, error: String(error) });
      }
    }
  }
}

export const connectionManager = new ConnectionManager();
