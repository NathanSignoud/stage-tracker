import { Kanban, Plus, Table2 } from "lucide-react";
import Link from "next/link";
import { ApplicationsTable } from "@/components/applications/applications-table";
import { KanbanBoard } from "@/components/applications/kanban-board";
import { NewApplicationButton } from "@/components/applications/application-form";
import { PageHeader } from "@/components/page-header";
import { getDb } from "@/db";
import { localDate } from "@/lib/dates";
import { CLOSED_STATUSES, isStatus } from "@/lib/domain/constants";
import { cn } from "@/lib/utils";
import { listApplications } from "@/server/services/applications";

export const metadata = { title: "Candidatures" };

export default async function ApplicationsPage({ searchParams }: PageProps<"/candidatures">) {
  const params = await searchParams;
  const view = params.vue === "tableau" ? "table" : "kanban";
  const statuses = [params.statut].flat().filter(isStatus);
  const items = listApplications(getDb());
  const today = localDate();
  const open = items.filter((i) => !CLOSED_STATUSES.includes(i.status)).length;

  return (
    <div>
      <PageHeader
        title="Candidatures"
        description={`${open} en cours · ${items.length - open} clôturée${items.length - open > 1 ? "s" : ""}`}
        actions={
          <>
            <div className="flex h-8 rounded-md border p-0.5">
              {(
                [
                  ["kanban", "/candidatures", "Kanban", Kanban],
                  ["table", "/candidatures?vue=tableau", "Tableau", Table2],
                ] as const
              ).map(([key, href, label, Icon]) => (
                <Link
                  key={key}
                  href={href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] text-muted-foreground",
                    view === key && "bg-muted font-medium text-foreground",
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </Link>
              ))}
            </div>
            <NewApplicationButton>
              <Plus /> Candidature complète
            </NewApplicationButton>
          </>
        }
      />
      {view === "kanban" ? (
        <KanbanBoard items={items} today={today} />
      ) : (
        <ApplicationsTable key={statuses.join()} items={items} today={today} initialStatuses={statuses} />
      )}
    </div>
  );
}
