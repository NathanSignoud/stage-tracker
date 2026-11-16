"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { applications, tasks } from "@/db/schema";
import { INTERVIEW_STATUSES, PREP_QUESTION_KINDS, TEMPLATE_KINDS, type Status } from "@/lib/domain/constants";
import type { ImportedOffer } from "@/lib/domain/offer-parsing";
import { localDateTime } from "@/lib/dates";
import { markFollowedUp, NotFoundError, openTask, setOfferText } from "@/server/services/applications";
import { importBaseFolder, type BaseImportReport } from "@/server/services/base-import";
import { saveLetterVersion, setBaseDocument } from "@/server/services/documents";
import { createInteraction } from "@/server/services/interactions";
import { createKeyword, deleteKeyword, updateKeyword } from "@/server/services/keywords";
import { importOfferFromUrl, OfferImportError } from "@/server/services/offer-import";
import {
  addDefaultPrepQuestions,
  addPrepQuestion,
  reviewPrepQuestion,
  saveCompanyNotes,
  updatePrepQuestion,
} from "@/server/services/prep";
import { listTemplates, renderForApplication, resetTemplate, updateTemplate, type RenderedTemplate } from "@/server/services/templates";
import { getApplicationDetail } from "@/server/services/applications";
import { errorMessage, mutate, type ActionResult } from "./result";

const id = z.coerce.number().int().positive();
const keywordSchema = z.object({
  label: z.string().trim().min(1, "Le mot-clé est vide"),
  category: z.string().trim().nullish().transform((v) => v || null),
  aliases: z.array(z.string()).default([]),
  mine: z.boolean().default(false),
});

function read<T>(fn: () => T): ActionResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

// --- Mots-clés et analyse de l'offre ------------------------------------------------

export async function createKeywordAction(input: unknown) {
  return mutate(() => createKeyword(getDb(), keywordSchema.parse(input)));
}

export async function updateKeywordAction(keywordId: number, patch: unknown) {
  return mutate(() => updateKeyword(getDb(), id.parse(keywordId), keywordSchema.partial().parse(patch)));
}

export async function deleteKeywordAction(keywordId: number) {
  return mutate(() => deleteKeyword(getDb(), id.parse(keywordId)));
}

export async function setOfferTextAction(applicationId: number, text: string) {
  return mutate(() => setOfferText(getDb(), id.parse(applicationId), z.string().max(100_000).parse(text)));
}

/** Lit une offre depuis son lien (pour pré-remplir un formulaire, rien n'est enregistré). */
export async function importOfferAction(url: string): Promise<ActionResult<ImportedOffer & { url: string }>> {
  try {
    return { ok: true, data: await importOfferFromUrl(z.string().max(2000).parse(url)) };
  } catch (error) {
    return { ok: false, error: error instanceof OfferImportError ? error.message : errorMessage(error) };
  }
}

/** Importe le texte de l'offre depuis le lien enregistré sur la candidature (et complète lieu / date limite). */
export async function importOfferIntoApplicationAction(applicationId: number) {
  const db = getDb();
  const app = db.select().from(applications).where(eq(applications.id, id.parse(applicationId))).get();
  if (!app?.offerUrl) return { ok: false as const, error: "Aucun lien d'offre sur cette candidature" };
  const imported = await importOfferAction(app.offerUrl);
  if (!imported.ok) return imported;
  return mutate(() => {
    setOfferText(db, app.id, imported.data.offerText);
    db.update(applications)
      .set({
        location: app.location ?? imported.data.location,
        deadline: app.deadline ?? imported.data.deadline,
        remote: app.remote ?? imported.data.remote,
        title: app.title || imported.data.title || "",
      })
      .where(eq(applications.id, app.id))
      .run();
    return imported.data.method;
  });
}

// --- Gabarits, prompts et messages -----------------------------------------------------

export async function updateTemplateAction(templateId: number, input: unknown) {
  const schema = z.object({
    name: z.string().trim().min(1, "Le nom est vide"),
    subject: z.string().nullish().transform((v) => v ?? null),
    body: z.string().min(1, "Le texte est vide"),
  });
  return mutate(() => updateTemplate(getDb(), id.parse(templateId), schema.parse(input)));
}

export async function resetTemplateAction(templateId: number) {
  return mutate(() => resetTemplate(getDb(), id.parse(templateId)));
}

export async function renderTemplateAction(kind: string, key: string, applicationId: number): Promise<ActionResult<RenderedTemplate>> {
  return read(() => renderForApplication(getDb(), z.enum(TEMPLATE_KINDS).parse(kind), z.string().parse(key), id.parse(applicationId)));
}

export type MessageComposer = {
  company: string;
  templates: RenderedTemplate[];
  contacts: { id: number; name: string; email: string | null; relation: string | null }[];
  /** Gabarit proposé selon l'étape (relance après candidature ou après entretien). */
  suggestedKey: string;
};

export async function messageComposerAction(applicationId: number): Promise<ActionResult<MessageComposer>> {
  return read(() => {
    const db = getDb();
    const appId = id.parse(applicationId);
    const detail = getApplicationDetail(db, appId);
    if (!detail) throw new NotFoundError("Candidature introuvable");
    const inInterview = [...INTERVIEW_STATUSES, "offer" as Status].includes(detail.application.status);
    return {
      company: detail.application.company,
      templates: listTemplates(db, "message").map((t) => renderForApplication(db, "message", t.key, appId)),
      contacts: detail.contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, relation: c.relation })),
      suggestedKey: inInterview ? "follow_up_interview" : "follow_up",
    };
  });
}

/**
 * « Marquer comme envoyé » : l'échange est consigné dans la timeline, une relance fait passer la
 * candidature en Relancée (ou coche la relance), un remerciement coche la tâche « remerciement ».
 */
export async function recordMessageSentAction(applicationId: number, input: unknown) {
  const schema = z.object({
    templateKey: z.string(),
    templateName: z.string(),
    contactId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
    subject: z.string().nullish(),
    body: z.string().min(1),
  });
  return mutate(() => {
    const db = getDb();
    const appId = id.parse(applicationId);
    const msg = schema.parse(input);
    return db.transaction((tx) => {
      createInteraction(tx, {
        applicationId: appId,
        contactId: msg.contactId,
        date: localDateTime(),
        type: msg.templateKey === "linkedin" ? "linkedin" : "email_sent",
        summary: msg.templateName,
        content: [msg.subject && `Objet : ${msg.subject}`, msg.body].filter(Boolean).join("\n\n"),
        location: null,
        nextAction: null,
        nextActionDate: null,
      });
      if (msg.templateKey.startsWith("follow_up")) markFollowedUp(tx, appId);
      if (msg.templateKey === "thank_you") {
        const open = tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.applicationId, appId), eq(tasks.origin, "thank_you"), openTask))
          .all()
          .map((t) => t.id);
        if (open.length) tx.update(tasks).set({ doneAt: new Date().toISOString() }).where(inArray(tasks.id, open)).run();
      }
    });
  });
}

// --- Documents de base et lettres --------------------------------------------------------

export async function setBaseDocumentAction(documentId: number) {
  return mutate(() => setBaseDocument(getDb(), id.parse(documentId)));
}

export async function importBaseFolderAction(): Promise<ActionResult<BaseImportReport>> {
  try {
    const report = await importBaseFolder(getDb());
    return mutate(() => report);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function saveLetterVersionAction(applicationId: number, content: string) {
  return mutate(() => saveLetterVersion(getDb(), id.parse(applicationId), z.string().max(50_000).parse(content)));
}

// --- Préparation d'entretien ----------------------------------------------------------------

export async function saveCompanyNotesAction(applicationId: number, notes: string) {
  return mutate(() => saveCompanyNotes(getDb(), id.parse(applicationId), z.string().max(50_000).parse(notes)));
}

export async function addPrepQuestionAction(applicationId: number, input: unknown) {
  const schema = z.object({
    kind: z.enum(PREP_QUESTION_KINDS),
    question: z.string().trim().min(1, "La question est vide"),
    answer: z.string().nullish(),
  });
  return mutate(() => addPrepQuestion(getDb(), id.parse(applicationId), schema.parse(input)));
}

export async function updatePrepQuestionAction(questionId: number, input: unknown) {
  const schema = z.object({
    question: z.string().trim().min(1, "La question est vide"),
    answer: z.string().nullish().transform((v) => v ?? null),
  });
  return mutate(() => updatePrepQuestion(getDb(), id.parse(questionId), schema.parse(input)));
}

export async function reviewPrepQuestionAction(questionId: number, confidence: number) {
  return mutate(() =>
    reviewPrepQuestion(getDb(), id.parse(questionId), z.union([z.literal(0), z.literal(1), z.literal(2)]).parse(confidence)),
  );
}

export async function addDefaultPrepQuestionsAction(applicationId: number) {
  return mutate(() => addDefaultPrepQuestions(getDb(), id.parse(applicationId)));
}
