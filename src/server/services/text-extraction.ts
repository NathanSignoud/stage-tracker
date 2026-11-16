import path from "node:path";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const EXTRACTABLE = [".docx", ".pdf", ".md", ".txt"];

export function mimeFor(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return (
    {
      ".pdf": "application/pdf",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".md": "text/markdown",
      ".txt": "text/plain",
    }[ext] ?? "application/octet-stream"
  );
}

/** Texte brut d'un CV / d'une lettre (DOCX, PDF, Markdown, texte) ; null si illisible. */
export async function extractDocumentText(fileName: string, bytes: Uint8Array): Promise<string | null> {
  const ext = path.extname(fileName).toLowerCase();
  try {
    let text = "";
    if (ext === ".docx") text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    else if (ext === ".pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      text = (await extractText(pdf, { mergePages: true })).text;
    } else if (ext === ".md" || ext === ".txt") text = new TextDecoder("utf-8").decode(bytes);
    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return text || null;
  } catch {
    return null; // PDF scanné, fichier corrompu… : le texte pourra être collé à la main.
  }
}
