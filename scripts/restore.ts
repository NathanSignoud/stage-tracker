// npm run restore -- data/backups/<fichier>.json
// Sauvegarde d'abord l'état actuel (pre-restore-…), puis remplace toutes les données.
import fs from "node:fs";
import path from "node:path";
import { openDb } from "@/db";
import { importDatabase, parseBackup, writeBackup } from "@/lib/backup";
import { BACKUP_DIR, DB_FILE } from "@/lib/paths";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage : npm run restore -- data/backups/<fichier>.json");
  process.exit(1);
}
const source = path.resolve(arg);
if (!fs.existsSync(source)) {
  console.error(`Fichier introuvable : ${source}`);
  process.exit(1);
}

const backup = parseBackup(fs.readFileSync(source, "utf8"));
const db = openDb(DB_FILE);
try {
  const safety = writeBackup(db.$client, BACKUP_DIR, "pre-restore");
  console.log(`✓ État actuel sauvegardé : ${path.relative(process.cwd(), safety)}`);
  const report = importDatabase(db.$client, backup);
  console.log(`✓ Restauration terminée : ${report.rows} lignes (sauvegarde du ${backup.exportedAt})`);
  if (report.ignoredTables.length) console.warn(`  Tables ignorées : ${report.ignoredTables.join(", ")}`);
  if (report.ignoredColumns.length) console.warn(`  Colonnes ignorées : ${report.ignoredColumns.join(", ")}`);
  console.log("  Recharge la page dans le navigateur pour voir les données restaurées.");
} finally {
  db.$client.close();
}
