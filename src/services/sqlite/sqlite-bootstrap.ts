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

// We don't import types from "bun:sqlite" here because that ambient import
// breaks Node-side type-checking when @types/bun is not installed. Callers
// treat the return value as an opaque sqlite-style Database constructor.
type DatabaseCtor = new (filename?: string, options?: unknown) => unknown;

let Database: DatabaseCtor | undefined;

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

export function getDatabase(): DatabaseCtor {
  if (Database) return Database;

  const req = createRequire(import.meta.url);

  if (isBun) {
    Database = req("bun:sqlite").Database as DatabaseCtor;
    return Database;
  }

  // Node runtime — try built-in `node:sqlite` first. It exposes `DatabaseSync`
  // which matches bun:sqlite's synchronous prepare/run/all/get API surface
  // that this project uses.
  try {
    const nodeSqlite = req("node:sqlite") as { DatabaseSync: DatabaseCtor };
    Database = nodeSqlite.DatabaseSync;
    return Database;
  } catch {
    // node:sqlite isn't available (Node < 22.5, or experimental flag not set
    // in some embedded runtimes). Fall back to better-sqlite3 — wire-compatible
    // API, requires a native postinstall but ships prebuilt binaries for
    // common platforms.
    try {
      const betterSqlite = req("better-sqlite3") as DatabaseCtor;
      Database = betterSqlite;
      return Database;
    } catch (error) {
      throw new Error(
        "opencode-mem: no SQLite binding available. Install better-sqlite3, " +
          "or run on Node ≥22.5 with `--experimental-sqlite`, or use Bun. " +
          `Underlying error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
