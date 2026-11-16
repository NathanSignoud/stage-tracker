import fs from "node:fs";
import { getDb } from "@/db";
import { getDocumentFile } from "@/server/services/documents";

export async function GET(_request: Request, { params }: RouteContext<"/api/documents/[id]">) {
  const { id } = await params;
  try {
    const { doc, absolutePath } = getDocumentFile(getDb(), Number(id));
    const body = fs.readFileSync(absolutePath);
    const name = doc.fileName ?? doc.filePath!;
    return new Response(body, {
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        // Un fichier HTML/SVG ajouté ne doit pas pouvoir exécuter de script avec la session de l'app.
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Fichier introuvable", { status: 404 });
  }
}
