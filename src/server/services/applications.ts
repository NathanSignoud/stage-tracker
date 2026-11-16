import { and, asc, desc, eq, inArray, isNull, lte, max, min, sql } from "drizzle-orm";
import type { Conn } from "@/db";
import {
  applicationContacts,
  applicationDocuments,
  applications,
  applicationTags,
  contacts,
  documents,
  interactions,
  statusChanges,
  tags,
  tasks,
  type Application,
} from "@/db/schema";
import { addDays, isoToLocalDate, localDate, localDateTime } from "@/lib/dates";
import type { Status } from "@/lib/domain/constants";
import { isStale, lastActivityDate, planStatusChange } from "@/lib/domain/follow-ups";
import type { ApplicationInput, QuickAddInput } from "@/lib/validation";
import { scoreOffer } from "./keywords";
import { getSettings } from "./settings";

export class NotFoundError extends Error {
  constructor(what = "Élément introuvable") {
    super(what);
  }
}

/** Tâche ouverte : ni faite, ni annulée, ni à la corbeille. */
export const openTask = and(isNull(tasks.doneAt), isNull(tasks.cancelledAt), isNull(tasks.deletedAt));

function openFollowUpTaskIds(conn: Conn, applicationId: number): number[] {
  return conn
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.applicationId, applicationId), eq(tasks.origin, "auto_followup"), openTask))
    .all()
    .map((t) => t.id);
}

/** Enregistre un changement de statut (historique + relances automatiques). */
function applyStatusChange(
  conn: Conn,
  app: Pick<Application, "id" | "company" | "sentDate">,
  from: Status | null,
  to: Status,
  now: Date,
): void {
  const settings = getSettings(conn);
  const nowIso = now.toISOString();
  const plan = planStatusChange({
    from,
    to,
    company: app.company,
    sentDate: app.sentDate,
    today: localDate(now),
    openFollowUpTaskIds: openFollowUpTaskIds(conn, app.id),
    followUpDelayDays: settings.followUpDelayDays,
    secondFollowUpDelayDays: settings.secondFollowUpDelayDays,
  });

  conn
    .update(applications)
    .set({ status: to, updatedAt: nowIso, ...(plan.sentDate ? { sentDate: plan.sentDate } : {}) })
    .where(eq(applications.id, app.id))
    .run();
  conn
    .insert(statusChanges)
    .values({ applicationId: app.id, fromStatus: from, toStatus: to, changedAt: nowIso })
    .run();
  for (const task of plan.createTasks) {
    conn
      .insert(tasks)
      .values({ ...task, applicationId: app.id, origin: "auto_followup", createdAt: nowIso })
      .run();
  }
  if (plan.completeTaskIds.length) {
    conn.update(tasks).set({ doneAt: nowIso }).where(inArray(tasks.id, plan.completeTaskIds)).run();
  }
  if (plan.cancelTaskIds.length) {
    conn
      .update(tasks)
      .set({ cancelledAt: nowIso })
      .where(inArray(tasks.id, plan.cancelTaskIds))
      .run();
  }
}

export function createApplication(
  conn: Conn,
  input: (ApplicationInput | QuickAddInput) & { status?: Status },
  now = new Date(),
): number {
  return conn.transaction((tx) => {
    const { tags: tagNames, status = "to_explore", ...fields } = input as ApplicationInput & {
      status?: Status;
    };
    const nowIso = now.toISOString();
    const { id } = tx
      .insert(applications)
      .values({ ...fields, status, matchScore: scoreOffer(tx, fields.offerText), createdAt: nowIso, updatedAt: nowIso })
      .returning({ id: applications.id })
      .get();
    applyStatusChange(tx, { id, company: fields.company, sentDate: fields.sentDate ?? null }, null, status, now);
    if (tagNames) setApplicationTags(tx, id, tagNames);
    return id;
  });
}

export function updateApplication(conn: Conn, id: number, input: ApplicationInput, now = new Date()): void {
  conn.transaction((tx) => {
    const app = getLiveApplication(tx, id);
    const { tags: tagNames, ...fields } = input;
    tx.update(applications)
      .set({ ...fields, matchScore: scoreOffer(tx, fields.offerText), updatedAt: now.toISOString() })
      .where(eq(applications.id, id))
      .run();
    if (tagNames) setApplicationTags(tx, id, tagNames);

    // Date d'envoi corrigée alors que la 1re relance est en attente : on recale son échéance.
    if (app.status === "sent" && fields.sentDate && fields.sentDate !== app.sentDate) {
      const { followUpDelayDays } = getSettings(tx);
      const ids = openFollowUpTaskIds(tx, id);
      if (ids.length && followUpDelayDays > 0) {
        tx.update(tasks)
          .set({ dueDate: addDays(fields.sentDate, followUpDelayDays) })
          .where(inArray(tasks.id, ids))
          .run();
      }
    }
  });
}

/** Remplace uniquement le texte de l'offre (collé ou importé) et recalcule le score. */
export function setOfferText(conn: Conn, id: number, text: string | null, now = new Date()): void {
  getLiveApplication(conn, id);
  const offerText = text?.trim() ? text.trim() : null;
  conn
    .update(applications)
    .set({ offerText, matchScore: scoreOffer(conn, offerText), updatedAt: now.toISOString() })
    .where(eq(applications.id, id))
    .run();
}

export function changeStatus(conn: Conn, id: number, to: Status, now = new Date()): void {
  conn.transaction((tx) => {
    const app = getLiveApplication(tx, id);
    if (app.status === to) return;
    applyStatusChange(tx, app, app.status, to, now);
  });
}

/**
 * « J'ai relancé » depuis le tableau de bord : passe la candidature en Relancée si elle était
 * Envoyée (ce qui planifie la 2e relance), sinon coche simplement les relances ouvertes.
 */
export function markFollowedUp(conn: Conn, id: number, now = new Date()): void {
  conn.transaction((tx) => {
    const app = getLiveApplication(tx, id);
    if (app.status === "sent") {
      applyStatusChange(tx, app, app.status, "followed_up", now);
      return;
    }
    const ids = openFollowUpTaskIds(tx, id);
    if (ids.length) {
      tx.update(tasks).set({ doneAt: now.toISOString() }).where(inArray(tasks.id, ids)).run();
    }
  });
}

function getLiveApplication(conn: Conn, id: number): Application {
  const app = conn.select().from(applications).where(eq(applications.id, id)).get();
  if (!app || app.deletedAt) throw new NotFoundError("Candidature introuvable");
  return app;
}

export function setApplicationTags(conn: Conn, applicationId: number, names: string[]): void {
  const unique = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name && !unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), name);
  }
  conn.delete(applicationTags).where(eq(applicationTags.applicationId, applicationId)).run();
  for (const name of unique.values()) {
    let tag = conn
      .select()
      .from(tags)
      .where(sql`lower(${tags.name}) = lower(${name})`)
      .get();
    tag ??= conn.insert(tags).values({ name }).returning().get();
    conn.insert(applicationTags).values({ applicationId, tagId: tag.id }).run();
  }
}

export function listTagNames(conn: Conn): string[] {
  return conn
    .select({ name: tags.name })
    .from(tags)
    .orderBy(asc(tags.name))
    .all()
    .map((t) => t.name);
}

export type ApplicationListItem = Application & {
  tags: string[];
  lastActivity: string | null;
  stale: boolean;
  /** Échéance la plus proche parmi les tâches ouvertes. */
  nextDue: string | null;
};

export function listApplications(conn: Conn, now = new Date()): ApplicationListItem[] {
  const today = localDate(now);
  const { staleAfterDays } = getSettings(conn);
  const apps = conn
    .select()
    .from(applications)
    .where(isNull(applications.deletedAt))
    .orderBy(asc(applications.priority), desc(applications.updatedAt))
    .all();

  const tagsByApp = new Map<number, string[]>();
  for (const row of conn
    .select({ applicationId: applicationTags.applicationId, name: tags.name })
    .from(applicationTags)
    .innerJoin(tags, eq(tags.id, applicationTags.tagId))
    .orderBy(asc(tags.name))
    .all()) {
    tagsByApp.set(row.applicationId, [...(tagsByApp.get(row.applicationId) ?? []), row.name]);
  }

  const lastChange = new Map(
    conn
      .select({ applicationId: statusChanges.applicationId, last: max(statusChanges.changedAt) })
      .from(statusChanges)
      .groupBy(statusChanges.applicationId)
      .all()
      .map((r) => [r.applicationId, r.last ? isoToLocalDate(r.last) : null]),
  );
  const lastInteraction = new Map(
    conn
      .select({ applicationId: interactions.applicationId, last: max(interactions.date) })
      .from(interactions)
      .where(and(isNull(interactions.deletedAt), lte(interactions.date, localDateTime(now))))
      .groupBy(interactions.applicationId)
      .all()
      .map((r) => [r.applicationId, r.last]),
  );
  const nextDue = new Map(
    conn
      .select({ applicationId: tasks.applicationId, next: min(tasks.dueDate) })
      .from(tasks)
      .where(openTask)
      .groupBy(tasks.applicationId)
      .all()
      .map((r) => [r.applicationId, r.next]),
  );

  return apps.map((app) => {
    const lastActivity = lastActivityDate([
      app.sentDate,
      lastChange.get(app.id),
      lastInteraction.get(app.id),
    ]);
    return {
      ...app,
      tags: tagsByApp.get(app.id) ?? [],
      lastActivity,
      stale: isStale({ status: app.status, lastActivity, today, staleAfterDays }),
      nextDue: nextDue.get(app.id) ?? null,
    };
  });
}

export function getApplicationDetail(conn: Conn, id: number) {
  const app = conn.select().from(applications).where(eq(applications.id, id)).get();
  if (!app) return null;

  const tagNames = conn
    .select({ name: tags.name })
    .from(applicationTags)
    .innerJoin(tags, eq(tags.id, applicationTags.tagId))
    .where(eq(applicationTags.applicationId, id))
    .orderBy(asc(tags.name))
    .all()
    .map((t) => t.name);

  const history = conn
    .select()
    .from(statusChanges)
    .where(eq(statusChanges.applicationId, id))
    .orderBy(asc(statusChanges.changedAt), asc(statusChanges.id))
    .all();

  const timeline = conn
    .select({ interaction: interactions, contactName: contacts.name })
    .from(interactions)
    .leftJoin(contacts, eq(contacts.id, interactions.contactId))
    .where(and(eq(interactions.applicationId, id), isNull(interactions.deletedAt)))
    .orderBy(desc(interactions.date))
    .all()
    .map((r) => ({ ...r.interaction, contactName: r.contactName }));

  const linkedContacts = conn
    .select({ contact: contacts, relation: applicationContacts.relation })
    .from(applicationContacts)
    .innerJoin(contacts, eq(contacts.id, applicationContacts.contactId))
    .where(and(eq(applicationContacts.applicationId, id), isNull(contacts.deletedAt)))
    .orderBy(asc(contacts.name))
    .all()
    .map((r) => ({ ...r.contact, relation: r.relation }));

  const linkedDocuments = conn
    .select({ document: documents, sentAt: applicationDocuments.sentAt })
    .from(applicationDocuments)
    .innerJoin(documents, eq(documents.id, applicationDocuments.documentId))
    .where(and(eq(applicationDocuments.applicationId, id), isNull(documents.deletedAt)))
    .orderBy(desc(applicationDocuments.sentAt))
    .all()
    .map((r) => ({ ...r.document, sentAt: r.sentAt }));

  const appTasks = conn
    .select()
    .from(tasks)
    .where(and(eq(tasks.applicationId, id), isNull(tasks.deletedAt)))
    .orderBy(sql`${tasks.doneAt} IS NOT NULL OR ${tasks.cancelledAt} IS NOT NULL`, asc(tasks.dueDate))
    .all();

  return {
    application: app,
    tags: tagNames,
    history,
    interactions: timeline,
    contacts: linkedContacts,
    documents: linkedDocuments,
    tasks: appTasks,
  };
}

export type ApplicationDetail = NonNullable<ReturnType<typeof getApplicationDetail>>;
