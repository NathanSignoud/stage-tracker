import { and, eq, inArray } from "drizzle-orm";
import type { Conn } from "@/db";
import { applications, interactions, tasks } from "@/db/schema";
import { CLOSED_STATUSES, INTERVIEW_KIND_STATUS, STATUSES } from "@/lib/domain/constants";
import { planInterviewTasks } from "@/lib/domain/follow-ups";
import type { InteractionInput } from "@/lib/validation";
import { changeStatus, NotFoundError, openTask } from "./applications";
import { getSettings } from "./settings";

/** Saisie d'un échange ; type d'entretien et durée sont facultatifs. */
export type InteractionData = Omit<InteractionInput, "interviewKind" | "durationMinutes"> &
  Partial<Pick<InteractionInput, "interviewKind" | "durationMinutes">>;

/** Le type d'entretien n'a de sens que pour un échange de type « entretien ». */
function normalize(input: InteractionData): InteractionInput {
  return {
    ...input,
    interviewKind: input.type === "interview" ? (input.interviewKind ?? null) : null,
    durationMinutes: input.durationMinutes ?? null,
  };
}

/**
 * Planifier un entretien RH / technique fait avancer la candidature au statut correspondant
 * (jamais de retour en arrière, jamais depuis un statut final).
 */
function advanceStatusForInterview(conn: Conn, input: InteractionInput, now: Date): void {
  const target = input.interviewKind && INTERVIEW_KIND_STATUS[input.interviewKind];
  if (!target || !input.applicationId) return;
  const app = conn.select().from(applications).where(eq(applications.id, input.applicationId)).get();
  if (!app || app.deletedAt || CLOSED_STATUSES.includes(app.status)) return;
  if (STATUSES.indexOf(app.status) < STATUSES.indexOf(target)) changeStatus(conn, app.id, target, now);
}

export function createInteraction(conn: Conn, raw: InteractionData, now = new Date()): number {
  const input = normalize(raw);
  return conn.transaction((tx) => {
    const nowIso = now.toISOString();
    const { id } = tx
      .insert(interactions)
      .values({ ...input, createdAt: nowIso, updatedAt: nowIso })
      .returning({ id: interactions.id })
      .get();
    syncNextActionTask(tx, id, input, nowIso);
    advanceStatusForInterview(tx, input, now);
    syncInterviewTasks(tx, id, input, nowIso, true);
    return id;
  });
}

export function updateInteraction(
  conn: Conn,
  id: number,
  raw: InteractionData,
  now = new Date(),
): void {
  const input = normalize(raw);
  conn.transaction((tx) => {
    const existing = tx.select().from(interactions).where(eq(interactions.id, id)).get();
    if (!existing || existing.deletedAt) throw new NotFoundError("Échange introuvable");
    const nowIso = now.toISOString();
    tx.update(interactions).set({ ...input, updatedAt: nowIso }).where(eq(interactions.id, id)).run();
    syncNextActionTask(tx, id, input, nowIso);
    advanceStatusForInterview(tx, input, now);
    syncInterviewTasks(tx, id, input, nowIso, false);
  });
}

/**
 * Après un entretien : remerciement (J+1) et relance (J+N), liés à l'entretien pour suivre ses
 * changements de date. Un nouvel entretien annule les relances automatiques encore ouvertes
 * (il y a eu des nouvelles).
 */
function syncInterviewTasks(conn: Conn, interactionId: number, input: InteractionInput, nowIso: string, isNew: boolean): void {
  const linked = conn
    .select()
    .from(tasks)
    .where(and(eq(tasks.interactionId, interactionId), inArray(tasks.origin, ["thank_you", "auto_followup"])))
    .all();

  if (input.type !== "interview" || !input.applicationId) {
    const open = linked.filter((t) => !t.doneAt && !t.cancelledAt && !t.deletedAt).map((t) => t.id);
    if (open.length) conn.update(tasks).set({ cancelledAt: nowIso }).where(inArray(tasks.id, open)).run();
    return;
  }

  const app = conn.select().from(applications).where(eq(applications.id, input.applicationId)).get();
  if (!app) return;
  if (isNew) {
    conn
      .update(tasks)
      .set({ cancelledAt: nowIso })
      .where(and(eq(tasks.applicationId, app.id), eq(tasks.origin, "auto_followup"), openTask))
      .run();
  }
  const settings = getSettings(conn);
  for (const planned of planInterviewTasks({
    company: app.company,
    interviewDate: input.date,
    thankYouReminder: settings.thankYouReminder,
    postInterviewFollowUpDays: settings.postInterviewFollowUpDays,
  })) {
    const existing = linked.find((t) => t.origin === planned.origin);
    if (!existing) {
      if (isNew) {
        conn
          .insert(tasks)
          .values({ ...planned, applicationId: app.id, interactionId, createdAt: nowIso })
          .run();
      }
    } else if (!existing.doneAt && !existing.cancelledAt) {
      conn.update(tasks).set({ title: planned.title, dueDate: planned.dueDate }).where(eq(tasks.id, existing.id)).run();
    }
  }
}

/**
 * La « prochaine action » d'un échange est matérialisée par une tâche liée, pour apparaître
 * dans le tableau de bord. Elle suit les modifications de l'échange tant qu'elle est ouverte.
 */
function syncNextActionTask(
  conn: Conn,
  interactionId: number,
  input: InteractionInput,
  nowIso: string,
): void {
  const open = conn
    .select()
    .from(tasks)
    .where(and(eq(tasks.interactionId, interactionId), eq(tasks.origin, "interaction"), openTask))
    .get();

  if (input.nextAction) {
    const values = {
      title: input.nextAction,
      dueDate: input.nextActionDate,
      applicationId: input.applicationId,
    };
    if (open) conn.update(tasks).set(values).where(eq(tasks.id, open.id)).run();
    else {
      conn
        .insert(tasks)
        .values({ ...values, interactionId, origin: "interaction", createdAt: nowIso })
        .run();
    }
  } else if (open) {
    conn.update(tasks).set({ cancelledAt: nowIso }).where(eq(tasks.id, open.id)).run();
  }
}
