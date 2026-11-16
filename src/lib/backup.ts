import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

// Sauvegarde = toutes les tables en JSON, lues en SQL brut (indépendant du schéma Drizzle,
// donc utilisable avant l'application d'une migration). Les fichiers de data/documents/ ne sont
// pas inclus : copier le dossier data/ entier pour une sauvegarde complète.

export const BACKUP_FORMAT = "stage-tracker-backup";

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  /** Nombre de migrations appliquées au moment de l'export. */
  migrations: number;
  tables: Record<string, Record<string, unknown>[]>;
};

function userTables(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((t) => t.name);
}

function columnsOf(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
}

function migrationCount(sqlite: Database.Database): number {
  try {
    return (sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n;
  } catch {
    return 0;
  }
}

export function exportDatabase(sqlite: Database.Database, now = new Date()): BackupFile {
  // Lecture dans une transaction : instantané cohérent même si l'app écrit en parallèle.
  return sqlite.transaction((): BackupFile => ({
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    migrations: migrationCount(sqlite),
    tables: Object.fromEntries(
      userTables(sqlite).map((t) => [t, sqlite.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]]),
    ),
  }))();
}

export function parseBackup(json: string): BackupFile {
  const data = JSON.parse(json) as Partial<BackupFile>;
  if (data.format !== BACKUP_FORMAT || data.version !== 1 || typeof data.tables !== "object") {
    throw new Error("Ce fichier n'est pas une sauvegarde stage-tracker valide");
  }
  return data as BackupFile;
}

export type ImportReport = { rows: number; ignoredTables: string[]; ignoredColumns: string[] };

/**
 * Remplace tout le contenu de la base par celui de la sauvegarde, dans une transaction.
 * Compatible avec une base plus récente : les colonnes ajoutées depuis prennent leur valeur
 * par défaut ; les tables/colonnes disparues sont ignorées et signalées.
 */
export function importDatabase(sqlite: Database.Database, backup: BackupFile): ImportReport {
  const existing = userTables(sqlite);
  const report: ImportReport = { rows: 0, ignoredTables: [], ignoredColumns: [] };

  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.transaction(() => {
      for (const table of existing) sqlite.prepare(`DELETE FROM "${table}"`).run();
      try {
        sqlite.prepare("DELETE FROM sqlite_sequence").run();
      } catch {
        // Pas de table AUTOINCREMENT : rien à réinitialiser.
      }
      for (const [table, rows] of Object.entries(backup.tables)) {
        if (!existing.includes(table)) {
          report.ignoredTables.push(table);
          continue;
        }
        const columns = new Set(columnsOf(sqlite, table));
        for (const row of rows) {
          const keys = Object.keys(row).filter((k) => {
            if (columns.has(k)) return true;
            const name = `${table}.${k}`;
            if (!report.ignoredColumns.includes(name)) report.ignoredColumns.push(name);
            return false;
          });
          if (!keys.length) continue;
          sqlite
            .prepare(
              `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
            )
            .run(...keys.map((k) => row[k]));
          report.rows++;
        }
      }
      const violations = sqlite.pragma("foreign_key_check") as unknown[];
      if (violations.length) throw new Error(`Sauvegarde incohérente : ${violations.length} référence(s) cassée(s)`);
    })();
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
  return report;
}

function timestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** Écrit `<dir>/<prefix>-AAAA-MM-JJ_HH-mm-ss.json` et renvoie son chemin. */
export function writeBackup(sqlite: Database.Database, dir: string, prefix: string, now = new Date()): string {
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `${prefix}-${timestamp(now)}.json`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${prefix}-${timestamp(now)}-${i}.json`);
  fs.writeFileSync(file, JSON.stringify(exportDatabase(sqlite, now), null, 2), "utf8");
  return file;
}

/** Ne garde que les `keep` sauvegardes les plus récentes portant ce préfixe. Renvoie les fichiers supprimés. */
export function rotateBackups(dir: string, prefix: string, keep: number): string[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".json"))
    .sort()
    .reverse();
  const removed = files.slice(keep);
  for (const f of removed) fs.rmSync(path.join(dir, f));
  return removed;
}

export function listBackups(dir: string): { name: string; size: number; modifiedAt: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
