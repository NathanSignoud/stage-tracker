"use server";

import { z } from "zod";
import { getDb } from "@/db";
import { contactInputSchema, documentInputSchema, interactionInputSchema, settingsInputSchema, taskInputSchema } from "@/lib/validation";
import { BACKUP_DIR } from "@/lib/paths";
import { writeBackup } from "@/lib/backup";
import { regenerateCalendarToken } from "@/server/services/calendar";
import { createContact, updateContact } from "@/server/services/contacts";
import { createDocument, linkDocument, unlinkDocument } from "@/server/services/documents";
import { extractDocumentText } from "@/server/services/text-extraction";
import { createInteraction, updateInteraction } from "@/server/services/interactions";
import { search } from "@/server/services/search";
import { updateSettings } from "@/server/services/settings";
import { createTask, postponeTask, setTaskDone } from "@/server/services/tasks";
import { TRASH_KINDS } from "@/lib/domain/constants";
import { moveToTrash, purgeFromTrash, restoreFromTrash } from "@/server/services/trash";
import { errorMessage, mutate, type ActionResult } from "./result";
import type { SearchResults } from "@/server/services/search";

const id = z.coerce.number().int().positive();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null);
const kind = z.enum(TRASH_KINDS);

// --- Échanges ---------------------------------------------------------------

export async function createInteractionAction(input: unknown) {
  return mutate(() => createInteraction(getDb(), interactionInputSchema.parse(input)));
}

export async function updateInteractionAction(interactionId: number, input: unknown) {
  return mutate(() => updateInteraction(getDb(), id.parse(interactionId), interactionInputSchema.parse(input)));
}

// --- Tâches -----------------------------------------------------------------

export async function createTaskAction(input: unknown) {
  return mutate(() => createTask(getDb(), taskInputSchema.parse(input)));
}

export async function setTaskDoneAction(taskId: number, done: boolean) {
  return mutate(() => setTaskDone(getDb(), id.parse(taskId), z.boolean().parse(done)));
}

export async function postponeTaskAction(taskId: number, days: number) {
  return mutate(() => postponeTask(getDb(), id.parse(taskId), z.number().int().min(1).max(60).parse(days)));
}

// --- Contacts ---------------------------------------------------------------

export async function createContactAction(input: unknown) {
  return mutate(() => createContact(getDb(), contactInputSchema.parse(input)));
}

export async function updateContactAction(contactId: number, input: unknown) {
  return mutate(() => updateContact(getDb(), id.parse(contactId), contactInputSchema.parse(input)));
}

// --- Documents --------------------------------------------------------------

/** FormData : kind, label, content?, file?, applicationId?, sentAt?, documentId? (lier un existant). */
export async function saveDocumentAction(form: FormData) {
  const file = form.get("file");
  const bytes = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
  // Pas de texte collé : on l'extrait du fichier (DOCX, PDF, Markdown) pour le diff et les prompts.
  const pasted = String(form.get("content") ?? "").trim();
  const extracted = bytes && !pasted ? await extractDocumentText((file as File).name, bytes) : null;
  return mutate(() => {
    const db = getDb();
    const applicationId = id.nullish().parse(form.get("applicationId") || null);
    const existing = id.nullish().parse(form.get("documentId") || null);
    let documentId = existing;
    if (!documentId) {
      const input = documentInputSchema.parse({
        kind: form.get("kind"),
        label: form.get("label"),
        content: pasted || extracted,
      });
      if (!bytes && !input.content) throw new Error("Ajoute un fichier ou colle le texte du document");
      documentId = createDocument(db, input, bytes ? { name: (file as File).name, type: (file as File).type, bytes } : null);
    }
    if (applicationId) linkDocument(db, applicationId, documentId, day.parse(form.get("sentAt")));
    return documentId;
  });
}

export async function unlinkDocumentAction(applicationId: number, documentId: number) {
  return mutate(() => unlinkDocument(getDb(), id.parse(applicationId), id.parse(documentId)));
}

// --- Corbeille --------------------------------------------------------------

export async function moveToTrashAction(k: string, itemId: number) {
  return mutate(() => moveToTrash(getDb(), kind.parse(k), id.parse(itemId)));
}

export async function restoreFromTrashAction(k: string, itemId: number) {
  return mutate(() => restoreFromTrash(getDb(), kind.parse(k), id.parse(itemId)));
}

export async function purgeFromTrashAction(k: string, itemId: number) {
  return mutate(() => purgeFromTrash(getDb(), kind.parse(k), id.parse(itemId)));
}

// --- Réglages & sauvegardes -------------------------------------------------

export async function updateSettingsAction(input: unknown) {
  return mutate(() => updateSettings(getDb(), settingsInputSchema.parse(input)));
}

export async function regenerateCalendarTokenAction() {
  return mutate(() => regenerateCalendarToken(getDb()));
}

export async function createBackupAction() {
  return mutate(() => writeBackup(getDb().$client, BACKUP_DIR, "backup").split(/[\\/]/).pop()!);
}

// --- Recherche (lecture seule) ----------------------------------------------

export async function searchAction(query: string): Promise<ActionResult<SearchResults>> {
  try {
    return { ok: true, data: search(getDb(), z.string().max(200).parse(query)) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
