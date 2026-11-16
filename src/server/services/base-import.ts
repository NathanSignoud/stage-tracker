import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import type { Conn } from "@/db";
import { documents } from "@/db/schema";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/domain/constants";
import { BASE_DIR, DOCUMENTS_DIR } from "@/lib/paths";
import { createDocument, getBaseDocument, setBaseDocument } from "./documents";
import { EXTRACTABLE, extractDocumentText, mimeFor } from "./text-extraction";

/** Type deviné d'après le nom : « CV_Prenom.pdf », « lettre-motivation.docx », « LM.md »… */
export function guessDocumentKind(fileName: string): DocumentKind | null {
  const name = fileName.toLowerCase();
  if (/(^|[^a-z])(cv|resume|curriculum)([^a-z]|$)/.test(name)) return "cv";
  if (/lettre|motivation|cover|(^|[^a-z])lm([^a-z]|$)/.test(name)) return "letter";
  return null;
}

export type BaseImportReport = {
  imported: { name: string; kind: DocumentKind; chars: number; isBase: boolean }[];
  skipped: { name: string; reason: string }[];
};

/**
 * Importe les fichiers de data/base/ (une seule fois chacun) : texte extrait pour les prompts et le
 * diff ; le premier CV / la première lettre deviennent les versions « de base ».
 */
export async function importBaseFolder(
  conn: Conn,
  baseDir = BASE_DIR,
  documentsDir = DOCUMENTS_DIR,
  now = new Date(),
): Promise<BaseImportReport> {
  const report: BaseImportReport = { imported: [], skipped: [] };
  if (!fs.existsSync(baseDir)) return report;
  const files = fs
    .readdirSync(baseDir)
    .filter((f) => EXTRACTABLE.includes(path.extname(f).toLowerCase()) && f !== "LISEZMOI.txt");

  for (const name of files) {
    const already = conn
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.fileName, name), isNull(documents.deletedAt)))
      .get();
    if (already) {
      report.skipped.push({ name, reason: "déjà importé" });
      continue;
    }
    const kind = guessDocumentKind(name);
    if (!kind) {
      report.skipped.push({ name, reason: "type inconnu : mets « CV » ou « lettre » dans le nom du fichier" });
      continue;
    }
    const bytes = new Uint8Array(fs.readFileSync(path.join(baseDir, name)));
    const content = await extractDocumentText(name, bytes);
    const isBase = !getBaseDocument(conn, kind);
    const id = createDocument(
      conn,
      { kind, label: `${DOCUMENT_KIND_LABELS[kind]} de base`, content },
      { name, type: mimeFor(name), bytes },
      now,
      documentsDir,
    );
    if (isBase) setBaseDocument(conn, id);
    report.imported.push({ name, kind, chars: content?.length ?? 0, isBase });
  }
  return report;
}
