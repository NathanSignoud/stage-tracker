import { PageHeader } from "@/components/page-header";
import { TrashList } from "@/components/trash-list";
import { getDb } from "@/db";
import { listTrash } from "@/server/services/trash";

export const metadata = { title: "Corbeille" };

export default function TrashPage() {
  const items = listTrash(getDb());
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Corbeille"
        description="Rien n'est effacé tant que tu ne le supprimes pas définitivement ici."
      />
      <TrashList items={items} />
    </div>
  );
}
