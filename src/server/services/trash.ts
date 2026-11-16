import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Conn } from "@/db";
import { applications, companies, contacts, documents, interactions, prepQuestions, tasks } from "@/db/schema";
import { INTERACTION_LABELS, type InteractionType, type TrashKind } from "@/lib/domain/constants";
import { NotFoundError } from "./applications";
import { deleteDocumentFile } from "./documents";

// Corbeille : « supprimer » renseigne deleted_at ; seule la corbeille supprime définitivement.

const tables = {
  application: applications,
  contact: contacts,
  interaction: interactions,
  task: tasks,
  document: documents,
  question: prepQuestions,
  company: companies,
};

export function moveToTrash(conn: Conn, kind: TrashKind, id: number, now = new Date()): void {
  conn.transaction((tx) => {
    const table = tables[kind];
    const stamp = now.toISOString();
    tx.update(table).set({ deletedAt: stamp }).where(eq(table.id, id)).run();
    // Les tâches « prochaine action » d'un échange partent et reviennent avec lui.
    if (kind === "interaction") {
      tx.update(tasks)
        .set({ deletedAt: stamp })
        .where(and(eq(tasks.interactionId, id), isNull(tasks.deletedAt)))
        .run();
    }
  });
}

export function restoreFromTrash(conn: Conn, kind: TrashKind, id: number): void {
  conn.transaction((tx) => {
    const table = tables[kind];
    const row = tx.select({ deletedAt: table.deletedAt }).from(table).where(eq(table.id, id)).get();
    if (!row) throw new NotFoundError();
    tx.update(table).set({ deletedAt: null }).where(eq(table.id, id)).run();
    if (kind === "interaction" && row.deletedAt) {
      tx.update(tasks)
        .set({ deletedAt: null })
        .where(and(eq(tasks.interactionId, id), eq(tasks.deletedAt, row.deletedAt)))
        .run();
    }
  });
}

/** Suppression définitive, uniquement pour un élément déjà dans la corbeille. */
export function purgeFromTrash(conn: Conn, kind: TrashKind, id: number): void {
  conn.transaction((tx) => {
    const table = tables[kind];
    const row = tx.select().from(table).where(eq(table.id, id)).get();
    if (!row) throw new NotFoundError();
    if (!row.deletedAt) throw new Error("Seuls les éléments de la corbeille peuvent être supprimés définitivement");
    if (kind === "interaction") {
      tx.delete(tasks).where(and(eq(tasks.interactionId, id), isNotNull(tasks.deletedAt))).run();
    }
    tx.delete(table).where(eq(table.id, id)).run();
    if (kind === "document") deleteDocumentFile((row as typeof documents.$inferSelect).filePath);
  });
}

export type TrashItem = { kind: TrashKind; id: number; label: string; detail: string; deletedAt: string };

export function listTrash(conn: Conn): TrashItem[] {
  const items: TrashItem[] = [];
  for (const a of conn.select().from(applications).where(isNotNull(applications.deletedAt)).all()) {
    items.push({ kind: "application", id: a.id, label: a.company, detail: a.title, deletedAt: a.deletedAt! });
  }
  for (const c of conn.select().from(contacts).where(isNotNull(contacts.deletedAt)).all()) {
    items.push({ kind: "contact", id: c.id, label: c.name, detail: [c.role, c.company].filter(Boolean).join(" · "), deletedAt: c.deletedAt! });
  }
  for (const i of conn
    .select({ interaction: interactions, company: applications.company })
    .from(interactions)
    .leftJoin(applications, eq(applications.id, interactions.applicationId))
    .where(isNotNull(interactions.deletedAt))
    .all()) {
    items.push({
      kind: "interaction",
      id: i.interaction.id,
      label: i.interaction.summary,
      detail: [INTERACTION_LABELS[i.interaction.type as InteractionType], i.company].filter(Boolean).join(" · "),
      deletedAt: i.interaction.deletedAt!,
    });
  }
  const deletedInteractionIds = new Set(items.filter((i) => i.kind === "interaction").map((i) => i.id));
  for (const t of conn
    .select({ task: tasks, company: applications.company })
    .from(tasks)
    .leftJoin(applications, eq(applications.id, tasks.applicationId))
    .where(isNotNull(tasks.deletedAt))
    .all()) {
    if (t.task.interactionId && deletedInteractionIds.has(t.task.interactionId)) continue;
    items.push({ kind: "task", id: t.task.id, label: t.task.title, detail: t.company ?? "", deletedAt: t.task.deletedAt! });
  }
  for (const q of conn
    .select({ q: prepQuestions, company: applications.company })
    .from(prepQuestions)
    .leftJoin(applications, eq(applications.id, prepQuestions.applicationId))
    .where(isNotNull(prepQuestions.deletedAt))
    .all()) {
    items.push({ kind: "question", id: q.q.id, label: q.q.question, detail: q.company ?? "", deletedAt: q.q.deletedAt! });
  }
  for (const c of conn.select().from(companies).where(isNotNull(companies.deletedAt)).all()) {
    items.push({ kind: "company", id: c.id, label: c.name, detail: [c.sector, c.location].filter(Boolean).join(" · "), deletedAt: c.deletedAt! });
  }
  for (const d of conn.select().from(documents).where(isNotNull(documents.deletedAt)).all()) {
    items.push({ kind: "document", id: d.id, label: d.label, detail: d.fileName ?? "", deletedAt: d.deletedAt! });
  }
  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}
