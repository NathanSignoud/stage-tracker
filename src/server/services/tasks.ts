import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Conn } from "@/db";
import { applications, tasks } from "@/db/schema";
import { addDays, localDate } from "@/lib/dates";
import type { TaskInput } from "@/lib/validation";
import { NotFoundError } from "./applications";

export function createTask(conn: Conn, input: TaskInput, now = new Date()): number {
  return conn
    .insert(tasks)
    .values({ ...input, origin: "manual", createdAt: now.toISOString() })
    .returning({ id: tasks.id })
    .get().id;
}

export function setTaskDone(conn: Conn, id: number, done: boolean, now = new Date()): void {
  conn
    .update(tasks)
    .set({ doneAt: done ? now.toISOString() : null, cancelledAt: null })
    .where(eq(tasks.id, id))
    .run();
}

/** Reporte une tâche de `days` jours, à partir de son échéance ou d'aujourd'hui si elle est passée. */
export function postponeTask(conn: Conn, id: number, days: number, now = new Date()): void {
  const task = conn.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) throw new NotFoundError("Tâche introuvable");
  const today = localDate(now);
  const from = task.dueDate && task.dueDate > today ? task.dueDate : today;
  conn.update(tasks).set({ dueDate: addDays(from, days) }).where(eq(tasks.id, id)).run();
}

export type TaskListItem = typeof tasks.$inferSelect & { company: string | null };

/** Toutes les tâches hors corbeille (et hors candidatures à la corbeille), ouvertes d'abord. */
export function listTasks(conn: Conn): TaskListItem[] {
  return conn
    .select({ task: tasks, company: applications.company })
    .from(tasks)
    .leftJoin(applications, eq(applications.id, tasks.applicationId))
    .where(and(isNull(tasks.deletedAt), isNull(applications.deletedAt)))
    .orderBy(
      sql`${tasks.doneAt} IS NOT NULL OR ${tasks.cancelledAt} IS NOT NULL`,
      sql`${tasks.dueDate} IS NULL`,
      asc(tasks.dueDate),
    )
    .all()
    .map((r) => ({ ...r.task, company: r.company }));
}
