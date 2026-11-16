import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LetterEditor } from "@/components/letters/letter-editor";
import { PageHeader } from "@/components/page-header";
import { PromptButton } from "@/components/prompts/prompt-button";
import { getDb } from "@/db";
import { getApplicationDetail } from "@/server/services/applications";
import { getBaseDocument, listApplicationLetters } from "@/server/services/documents";

export async function generateMetadata({ params }: PageProps<"/candidatures/[id]/lettre">) {
  const detail = getApplicationDetail(getDb(), Number((await params).id));
  return { title: `Lettre · ${detail?.application.company ?? ""}` };
}

export default async function LetterPage({ params }: PageProps<"/candidatures/[id]/lettre">) {
  const db = getDb();
  const id = Number((await params).id);
  const detail = getApplicationDetail(db, id);
  if (!detail || detail.application.deletedAt) notFound();
  const app = detail.application;
  const versions = listApplicationLetters(db, id).map((v) => ({
    id: v.id,
    label: v.label,
    content: v.content,
    createdAt: v.createdAt,
    sentAt: v.sentAt,
  }));

  return (
    <div className="mx-auto max-w-7xl">
      <Link href={`/candidatures/${id}`} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> {app.company}
      </Link>
      <PageHeader
        title={`Lettre de motivation · ${app.company}`}
        description="1. Prépare le prompt et fais rédiger la lettre par Claude · 2. Colle la version finale · 3. Enregistre et exporte."
        actions={<PromptButton applicationId={id} variant="letter" />}
      />
      <LetterEditor applicationId={id} company={app.company} baseText={getBaseDocument(db, "letter")?.content ?? null} versions={versions} />
    </div>
  );
}
