import { PageHeader, Panel } from "@/components/page-header";
import { AddTaskForm } from "@/components/tasks/add-task-form";
import { TaskRow } from "@/components/task-row";
import { getDb } from "@/db";
import { localDate } from "@/lib/dates";
import { listApplications } from "@/server/services/applications";
import { listTasks } from "@/server/services/tasks";

export const metadata = { title: "Tâches" };

export default function TasksPage() {
  const db = getDb();
  const today = localDate();
  const all = listTasks(db);
  const open = all.filter((t) => !t.doneAt && !t.cancelledAt);
  const groups = [
    { title: "En retard", items: open.filter((t) => t.dueDate && t.dueDate < today) },
    { title: "Aujourd'hui", items: open.filter((t) => t.dueDate === today) },
    { title: "À venir", items: open.filter((t) => t.dueDate && t.dueDate > today) },
    { title: "Sans échéance", items: open.filter((t) => !t.dueDate) },
  ];
  const closed = all.filter((t) => t.doneAt || t.cancelledAt).slice(0, 30);
  const applications = listApplications(db).map((a) => ({ id: a.id, company: a.company }));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Tâches" description={`${open.length} ouverte${open.length > 1 ? "s" : ""}`} />
      <div className="mb-4 rounded-3xl bg-card ring-1 ring-border px-5 py-3">
        <AddTaskForm applications={applications} />
      </div>
      <div className="grid gap-4">
        {groups
          .filter((g) => g.items.length)
          .map((g) => (
            <Panel key={g.title} title={g.title} count={g.items.length}>
              {g.items.map((t) => (
                <TaskRow key={t.id} task={t} company={t.company} today={today} />
              ))}
            </Panel>
          ))}
        {open.length === 0 && <p className="text-center text-[13px] text-muted-foreground">Aucune tâche ouverte.</p>}
        {closed.length > 0 && (
          <Panel title="Récemment terminées ou annulées" count={closed.length}>
            {closed.map((t) => (
              <TaskRow key={t.id} task={t} company={t.company} today={today} />
            ))}
          </Panel>
        )}
      </div>
    </div>
  );
}
