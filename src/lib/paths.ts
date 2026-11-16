import path from "node:path";

// Toutes les données personnelles vivent dans `data/` (gitignoré).
// STAGE_TRACKER_DATA_DIR permet de pointer ailleurs (tests, autre machine).
export const DATA_DIR = process.env.STAGE_TRACKER_DATA_DIR ?? path.join(process.cwd(), "data");
export const DB_FILE = path.join(DATA_DIR, "app.db");
export const BACKUP_DIR = path.join(DATA_DIR, "backups");
export const DOCUMENTS_DIR = path.join(DATA_DIR, "documents");
export const BASE_DIR = path.join(DATA_DIR, "base");
export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
