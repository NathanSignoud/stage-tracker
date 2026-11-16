import { ArrowLeft, CalendarClock, MapPin } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PrepBoard } from "@/components/prep/prep-board";
import { PromptButton } from "@/components/prompts/prompt-button";
import { getDb } from "@/db";
import { formatDayTime, localDate, localDateTime, relativeDay } from "@/lib/dates";
import { INTERVIEW_KIND_LABELS } from "@/lib/domain/constants";
import { getApplicationDetail } from "@/server/services/applications";
import { getPrep } from "@/server/services/prep";

export async function generateMetadata({ params }: PageProps<"/candidatures/[id]/preparation">) {
  const detail = getApplicationDetail(getDb(), Number((await params).id));
  return { title: `Préparation · ${detail?.application.company ?? ""}` };
}

export default async function PrepPage({ params }: PageProps<"/candidatures/[id]/preparation">) {
  const db = getDb();
  const id = Number((await params).id);
  const detail = getApplicationDetail(db, id);
  if (!detail || detail.application.deletedAt) notFound();
  const app = detail.application;
  const prep = getPrep(db, id);
  const now = localDateTime();
  const next = detail.interactions
    .filter((i) => i.type === "interview" && i.date > now)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  return (
    <div className="mx-auto max-w-6xl">
      <Link href={`/candidatures/${id}`} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> {app.company}
      </Link>
      <PageHeader
        title={`Préparer l'entretien · ${app.company}`}
        description={
          next ? (
            <span className="flex flex-wrap items-center gap-x-3">
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3.5" />
                {INTERVIEW_KIND_LABELS[next.interviewKind ?? "other"]} · {formatDayTime(next.date)} ({relativeDay(next.date, localDate())})
              </span>
              {next.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5" /> {next.location}
                </span>
              )}
            </span>
          ) : (
            "Aucun entretien planifié pour l'instant."
          )
        }
        actions={<PromptButton applicationId={id} variant="interview_prep" />}
      />
      <PrepBoard applicationId={id} notes={prep.notes} questions={prep.questions} />
    </div>
  );
}
