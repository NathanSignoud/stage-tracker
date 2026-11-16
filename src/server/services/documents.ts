import fs from "node:fs";
import path from "node:path";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import type { Conn } from "@/db";
import { applicationDocuments, applications, documents } from "@/db/schema";
import type { DocumentKind } from "@/lib/domain/constants";
import { DOCUMENTS_DIR } from "@/lib/paths";
import type { DocumentInput } from "@/lib/validation";
import { NotFoundError } from "./applications";

export type UploadedFile = { name: string; type: string; bytes: Uint8Array };

function safeFileName(name: string): string {
  const base = path.basename(name).normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return base.replace(/[^\w.-]+/g, "_").slice(-120) || "document";
}

/** Crée une version de document ; le fichier éventuel est copié dans `data/documents/`. */
export function createDocument(
  conn: Conn,
  input: DocumentInput & { isBase?: boolean },
  file: UploadedFile | null,
  now = new Date(),
  documentsDir = DOCUMENTS_DIR,
): number {
  return conn.transaction((tx) => {
    const { id } = tx
      .insert(documents)
      .values({
        ...input,
        fileName: file?.name ?? null,
        mimeType: file?.type || null,
        createdAt: now.toISOString(),
      })
      .returning({ id: documents.id })
      .get();
    if (file) {
      const relative = `${id}-${safeFileName(file.name)}`;
      fs.mkdirSync(documentsDir, { recursive: true });
      fs.writeFileSync(path.join(documentsDir, relative), file.bytes);
      tx.update(documents).set({ filePath: relative }).where(eq(documents.id, id)).run();
    }
    return id;
  });
}

export function linkDocument(
  conn: Conn,
  applicationId: number,
  documentId: number,
  sentAt: string | null,
): void {
  conn
    .insert(applicationDocuments)
    .values({ applicationId, documentId, sentAt })
    .onConflictDoUpdate({
      target: [applicationDocuments.applicationId, applicationDocuments.documentId],
      set: { sentAt },
    })
    .run();
}

export function unlinkDocument(conn: Conn, applicationId: number, documentId: number): void {
  conn
    .delete(applicationDocuments)
    .where(
      and(
        eq(applicationDocuments.applicationId, applicationId),
        eq(applicationDocuments.documentId, documentId),
      ),
    )
    .run();
}

/** Toutes les versions, avec les candidatures auxquelles chacune a été envoyée. */
export function listDocuments(conn: Conn) {
  const sentTo = new Map<number, { id: number; company: string; sentAt: string | null }[]>();
  for (const row of conn
    .select({
      documentId: applicationDocuments.documentId,
      id: applications.id,
      company: applications.company,
      sentAt: applicationDocuments.sentAt,
    })
    .from(applicationDocuments)
    .innerJoin(applications, eq(applications.id, applicationDocuments.applicationId))
    .where(isNull(applications.deletedAt))
    .orderBy(asc(applicationDocuments.sentAt))
    .all()) {
    const { documentId, ...app } = row;
    sentTo.set(documentId, [...(sentTo.get(documentId) ?? []), app]);
  }
  return conn
    .select()
    .from(documents)
    .where(isNull(documents.deletedAt))
    .orderBy(desc(documents.createdAt))
    .all()
    .map((d) => ({ ...d, sentTo: sentTo.get(d.id) ?? [] }));
}

export type DocumentListItem = ReturnType<typeof listDocuments>[number];

export function getDocumentFile(conn: Conn, id: number, documentsDir = DOCUMENTS_DIR) {
  const doc = conn.select().from(documents).where(eq(documents.id, id)).get();
  if (!doc?.filePath) throw new NotFoundError("Fichier introuvable");
  return { doc, absolutePath: path.join(documentsDir, doc.filePath) };
}

export function deleteDocumentFile(filePath: string | null, documentsDir = DOCUMENTS_DIR): void {
  if (filePath) fs.rmSync(path.join(documentsDir, filePath), { force: true });
}

/** Version « de base » (CV ou lettre) : référence pour les prompts et le diff des lettres. */
export function getBaseDocument(conn: Conn, kind: DocumentKind) {
  return conn
    .select()
    .from(documents)
    .where(and(eq(documents.kind, kind), eq(documents.isBase, true), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt))
    .get();
}

/** Une seule version de base par type. */
export function setBaseDocument(conn: Conn, id: number): void {
  conn.transaction((tx) => {
    const doc = tx.select().from(documents).where(eq(documents.id, id)).get();
    if (!doc || doc.deletedAt) throw new NotFoundError("Document introuvable");
    tx.update(documents).set({ isBase: false }).where(eq(documents.kind, doc.kind)).run();
    tx.update(documents).set({ isBase: true }).where(eq(documents.id, id)).run();
  });
}

/** Lettres liées à une candidature, la plus récente d'abord. */
export function listApplicationLetters(conn: Conn, applicationId: number) {
  return conn
    .select({ document: documents, sentAt: applicationDocuments.sentAt })
    .from(applicationDocuments)
    .innerJoin(documents, eq(documents.id, applicationDocuments.documentId))
    .where(
      and(
        eq(applicationDocuments.applicationId, applicationId),
        eq(documents.kind, "letter"),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.createdAt), desc(documents.id))
    .all()
    .map((r) => ({ ...r.document, sentAt: r.sentAt }));
}

/** Enregistre la lettre finale comme nouvelle version liée à la candidature (« v2 », « v3 »…). */
export function saveLetterVersion(conn: Conn, applicationId: number, content: string, now = new Date()): number {
  return conn.transaction((tx) => {
    const app = tx.select().from(applications).where(eq(applications.id, applicationId)).get();
    if (!app || app.deletedAt) throw new NotFoundError("Candidature introuvable");
    if (!content.trim()) throw new Error("La lettre est vide");
    const [{ n }] = tx
      .select({ n: count() })
      .from(applicationDocuments)
      .innerJoin(documents, eq(documents.id, applicationDocuments.documentId))
      .where(and(eq(applicationDocuments.applicationId, applicationId), eq(documents.kind, "letter")))
      .all();
    const id = createDocument(
      tx,
      { kind: "letter", label: `Lettre — ${app.company} — v${n + 1}`, content: content.trim() },
      null,
      now,
    );
    linkDocument(tx, applicationId, id, null);
    return id;
  });
}

export function getDocument(conn: Conn, id: number) {
  const doc = conn.select().from(documents).where(eq(documents.id, id)).get();
  if (!doc) throw new NotFoundError("Document introuvable");
  return doc;
}
