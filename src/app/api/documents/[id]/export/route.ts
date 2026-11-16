import { getDb } from "@/db";
import { letterToDocx, letterToPdf } from "@/lib/letter-export";
import { getDocument } from "@/server/services/documents";
import { getSettings } from "@/server/services/settings";

/** Export d'une version de lettre : ?format=docx (défaut) ou ?format=pdf. */
export async function GET(request: Request, { params }: RouteContext<"/api/documents/[id]/export">) {
  const { id } = await params;
  const db = getDb();
  let doc;
  try {
    doc = getDocument(db, Number(id));
  } catch {
    return new Response("Document introuvable", { status: 404 });
  }
  if (!doc.content?.trim()) return new Response("Ce document n'a pas de texte à exporter", { status: 404 });

  const { profile } = getSettings(db);
  const name = [doc.label, profile.fullName].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]+/g, " ").trim();
  const pdf = new URL(request.url).searchParams.get("format") === "pdf";
  const bytes = pdf ? await letterToPdf(doc.content, doc.label) : await letterToDocx(doc.content);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.${pdf ? "pdf" : "docx"}`)}`,
    },
  });
}
