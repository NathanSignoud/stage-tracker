// npm run backup : exporte toute la base en JSON horodaté dans data/backups/ (jamais supprimé automatiquement).
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { writeBackup } from "@/lib/backup";
import { BACKUP_DIR, DB_FILE } from "@/lib/paths";

if (!fs.existsSync(DB_FILE)) {
  console.error(`Aucune base trouvée (${DB_FILE}). Lance d'abord l'app avec « npm run dev ».`);
  process.exit(1);
}

const sqlite = new Database(DB_FILE);
try {
  const file = writeBackup(sqlite, BACKUP_DIR, "backup");
  console.log(`✓ Sauvegarde écrite : ${path.relative(process.cwd(), file)}`);
} finally {
  sqlite.close();
}
