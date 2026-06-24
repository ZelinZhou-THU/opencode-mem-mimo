/**
 * SQLite binding bootstrap — works under Bun and Node.
 *
 * Resolution order:
 *   1. Bun runtime → `bun:sqlite` (built-in, fastest, zero-install)
 *   2. Node runtime → `node:sqlite` `DatabaseSync` (built-in, Node 22.5+ experimental,
 *      stable in Node 24+)
 *   3. Fallback → `better-sqlite3` (peer dependency, full native binary)
 *
 * Required because opencode 1.15.x loads plugins under Node, not Bun — `bun:sqlite`
 * is a Bun-only built-in and Node's ESM loader rejects the `bun:` URL scheme.
 *
 * The detection runs once at first call; the resolved Database class is cached.
 */
import { createRequire } from "node:module";
let Database;
const isBun = typeof globalThis.Bun !== "undefined";
export function getDatabase() {
    if (Database)
        return Database;
    const req = createRequire(import.meta.url);
    if (isBun) {
        Database = req("bun:sqlite").Database;
        return Database;
    }
    // Node runtime — try built-in `node:sqlite` first. It exposes `DatabaseSync`
    // with the synchronous prepare/all/get/close API surface that matches
    // bun:sqlite. One gap: bun:sqlite (and better-sqlite3) expose `db.run(sql)`
    // for executing a single SQL statement without bindings — used throughout
    // this project for PRAGMA and CREATE INDEX setup. `node:sqlite`'s
    // DatabaseSync uses `db.exec(sql)` for that surface, so we subclass to
    // alias `db.run(sql)` onto `db.exec(sql)` (param-bound `db.run(sql, ...)`
    // is preserved for any future callers, falling back to a prepared statement).
    try {
        const DatabaseSync = req("node:sqlite")
            .DatabaseSync;
        class DatabaseSyncCompat extends DatabaseSync {
            run(sql, ...params) {
                if (params.length === 0) {
                    return this.exec(sql);
                }
                // bun:sqlite and better-sqlite3 accept a single array of bind values
                // (`db.run(sql, [a, b])`); node:sqlite's DatabaseSync treats an array as
                // a named-parameters object and throws `Unknown named parameter '0'`.
                // Spread it so positional `?` placeholders bind correctly. Callers such
                // as services/ai/session/ai-session-manager.ts use this array form.
                if (params.length === 1 && Array.isArray(params[0])) {
                    return this.prepare(sql).run(...params[0]);
                }
                return this.prepare(sql).run(...params);
            }
            // bun:sqlite and better-sqlite3 expose `db.transaction(fn)` that returns
            // a callable wrapping `fn` in BEGIN/COMMIT (auto-ROLLBACK on throw).
            // `node:sqlite`'s DatabaseSync has no equivalent. Used by
            // `api-handlers.handleAddMemory` and `services/client.addMemory`, so
            // POST /api/memories and any auto-capture path crash without it.
            //
            // Single-mode semantics only (BEGIN); the `.deferred` / `.immediate` /
            // `.exclusive` variants from better-sqlite3 are not exercised by this
            // codebase.
            transaction(fn) {
                const self = this;
                const wrapped = function (...args) {
                    self.exec("BEGIN");
                    try {
                        const result = fn.apply(this, args);
                        self.exec("COMMIT");
                        return result;
                    }
                    catch (err) {
                        try {
                            self.exec("ROLLBACK");
                        }
                        catch {
                            /* rollback failures after partial state are best-effort */
                        }
                        throw err;
                    }
                };
                return wrapped;
            }
        }
        Database = DatabaseSyncCompat;
        return Database;
    }
    catch {
        // node:sqlite isn't available (Node < 22.5, or experimental flag not set
        // in some embedded runtimes). Fall back to better-sqlite3 — wire-compatible
        // API, requires a native postinstall but ships prebuilt binaries for
        // common platforms.
        try {
            const betterSqlite = req("better-sqlite3");
            Database = betterSqlite;
            return Database;
        }
        catch (error) {
            throw new Error("opencode-mem: no SQLite binding available. Install better-sqlite3, " +
                "or run on Node ≥22.5 with `--experimental-sqlite`, or use Bun. " +
                `Underlying error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
