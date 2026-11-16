import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { DB_FILE, MIGRATIONS_DIR } from "@/lib/paths";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
/** Base ou transaction en cours : les services acceptent l'un comme l'autre. */
export type Conn = BaseSQLiteDatabase<"sync", Database.RunResult, typeof schema>;

/** Ouvre une base (fichier ou `:memory:`) et applique les migrations en attente. */
export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Les scripts (backup/restore) peuvent écrire pendant que l'app tourne.
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

// Singleton conservé entre les rechargements à chaud de `next dev`.
const globalForDb = globalThis as unknown as { __stageTrackerDb?: DB };

export function getDb(): DB {
  globalForDb.__stageTrackerDb ??= openDb(DB_FILE);
  return globalForDb.__stageTrackerDb;
}
