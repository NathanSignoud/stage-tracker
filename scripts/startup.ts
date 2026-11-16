// Exécuté avant `next dev` : sauvegarde automatique → migrations → données de départ.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { openDb } from "@/db";
import { rotateBackups, writeBackup } from "@/lib/backup";
import { BACKUP_DIR, BASE_DIR, DATA_DIR, DB_FILE, DOCUMENTS_DIR } from "@/lib/paths";
import { seedIfNeeded } from "@/server/seed";

const AUTO_BACKUPS_KEPT = 10;

for (const dir of [DATA_DIR, BASE_DIR, DOCUMENTS_DIR, BACKUP_DIR]) fs.mkdirSync(dir, { recursive: true });

const baseReadme = path.join(BASE_DIR, "LISEZMOI.txt");
if (!fs.existsSync(baseReadme)) {
  fs.writeFileSync(
    baseReadme,
    "Dépose ici ton CV et ta lettre de motivation « de base » (DOCX, PDF, Markdown ou texte).\n" +
      "Puis, dans l'app : Documents → Importer data/base/ (diff des lettres, prompts).\n",
    "utf8",
  );
}

if (fs.existsSync(DB_FILE)) {
  const sqlite = new Database(DB_FILE);
  try {
    const file = writeBackup(sqlite, BACKUP_DIR, "auto");
    const removed = rotateBackups(BACKUP_DIR, "auto", AUTO_BACKUPS_KEPT);
    console.log(`✓ Sauvegarde automatique : ${path.relative(process.cwd(), file)}` +
      (removed.length ? ` (${removed.length} ancienne(s) supprimée(s))` : ""));
  } finally {
    sqlite.close();
  }
}

const db = openDb(DB_FILE);
try {
  const seeded = seedIfNeeded(db);
  if (seeded.length) console.log(`✓ Données de départ : ${seeded.join(", ")}`);
  console.log(`✓ Base prête : ${path.relative(process.cwd(), DB_FILE)}`);
} finally {
  db.$client.close();
}
