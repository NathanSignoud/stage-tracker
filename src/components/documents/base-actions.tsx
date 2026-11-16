"use client";

import { FolderInput, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/use-action";
import { importBaseFolderAction, setBaseDocumentAction } from "@/server/actions/features";

export function ImportBaseButton() {
  const { pending, run } = useAction();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      title="Importe les CV / lettres déposés dans data/base/ (texte extrait automatiquement)"
      onClick={() =>
        run(() => importBaseFolderAction(), {
          onSuccess: (report) => {
            if (report.imported.length) {
              toast.success(`${report.imported.length} fichier(s) importé(s)`, {
                description: report.imported.map((i) => `${i.name}${i.chars ? "" : " (texte illisible : colle-le à la main)"}`).join(", "),
              });
            } else toast.info("Rien de nouveau dans data/base/");
            for (const s of report.skipped.filter((s) => s.reason !== "déjà importé")) toast.warning(`${s.name} : ${s.reason}`);
          },
        })
      }
    >
      <FolderInput /> Importer data/base/
    </Button>
  );
}

export function SetBaseButton({ documentId }: { documentId: number }) {
  const { pending, run } = useAction();
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      disabled={pending}
      aria-label="Définir comme version de base"
      title="Définir comme version de base (prompts, diff des lettres)"
      onClick={() => run(() => setBaseDocumentAction(documentId), { success: "Version de base mise à jour" })}
    >
      <Star />
    </Button>
  );
}
