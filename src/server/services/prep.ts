import { and, asc, eq, isNull } from "drizzle-orm";
import type { Conn } from "@/db";
import { interviewPreps, prepQuestions } from "@/db/schema";
import type { PrepQuestionKind } from "@/lib/domain/constants";
import { DEFAULT_PREP_QUESTIONS } from "@/lib/domain/prep";
import { normalizeText } from "@/lib/text";
import { NotFoundError } from "./applications";

export function getPrep(conn: Conn, applicationId: number) {
  const prep = conn.select().from(interviewPreps).where(eq(interviewPreps.applicationId, applicationId)).get();
  const questions = conn
    .select()
    .from(prepQuestions)
    .where(and(eq(prepQuestions.applicationId, applicationId), isNull(prepQuestions.deletedAt)))
    .orderBy(asc(prepQuestions.createdAt), asc(prepQuestions.id))
    .all();
  return { notes: prep?.companyNotes ?? null, questions };
}

export function saveCompanyNotes(conn: Conn, applicationId: number, notes: string, now = new Date()): void {
  const value = notes.trim() ? notes : null;
  conn
    .insert(interviewPreps)
    .values({ applicationId, companyNotes: value, updatedAt: now.toISOString() })
    .onConflictDoUpdate({ target: interviewPreps.applicationId, set: { companyNotes: value, updatedAt: now.toISOString() } })
    .run();
}

export function addPrepQuestion(
  conn: Conn,
  applicationId: number,
  input: { kind: PrepQuestionKind; question: string; answer?: string | null },
  now = new Date(),
): number {
  if (!input.question.trim()) throw new Error("La question est vide");
  return conn
    .insert(prepQuestions)
    .values({
      applicationId,
      kind: input.kind,
      question: input.question.trim(),
      answer: input.answer?.trim() || null,
      createdAt: now.toISOString(),
    })
    .returning({ id: prepQuestions.id })
    .get().id;
}

export function updatePrepQuestion(conn: Conn, id: number, input: { question: string; answer: string | null }): void {
  if (!input.question.trim()) throw new Error("La question est vide");
  conn
    .update(prepQuestions)
    .set({ question: input.question.trim(), answer: input.answer?.trim() || null })
    .where(eq(prepQuestions.id, id))
    .run();
}

/** Auto-évaluation en mode flashcards : 0 = à revoir, 1 = bien, 2 = parfait. */
export function reviewPrepQuestion(conn: Conn, id: number, confidence: 0 | 1 | 2, now = new Date()): void {
  const q = conn.select().from(prepQuestions).where(eq(prepQuestions.id, id)).get();
  if (!q) throw new NotFoundError("Question introuvable");
  conn
    .update(prepQuestions)
    .set({ confidence, reviewCount: q.reviewCount + 1, lastReviewedAt: now.toISOString() })
    .where(eq(prepQuestions.id, id))
    .run();
}

/** Ajoute les questions classiques absentes de la fiche. Renvoie le nombre ajouté. */
export function addDefaultPrepQuestions(conn: Conn, applicationId: number, now = new Date()): number {
  return conn.transaction((tx) => {
    const existing = new Set(getPrep(tx, applicationId).questions.map((q) => normalizeText(q.question)));
    let added = 0;
    for (const q of DEFAULT_PREP_QUESTIONS) {
      if (existing.has(normalizeText(q.question))) continue;
      addPrepQuestion(tx, applicationId, q, now);
      added++;
    }
    return added;
  });
}
