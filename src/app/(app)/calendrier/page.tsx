import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { CalendarView } from "@/components/calendar/calendar-view";
import { ConnectCalendarDialog } from "@/components/calendar/connect-calendar-dialog";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { addDays, formatDay, localDate, startOfWeek } from "@/lib/dates";
import { lanAddresses } from "@/lib/network";
import { getCalendarToken, listCalendarEvents } from "@/server/services/calendar";

export const metadata = { title: "Calendrier" };

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendrier">) {
  const { mois } = await searchParams;
  const today = localDate();
  const month = typeof mois === "string" && /^\d{4}-\d{2}$/.test(mois) ? mois : today.slice(0, 7);
  const monthEnd = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const gridStart = startOfWeek(`${month}-01`);
  const gridEnd = addDays(startOfWeek(monthEnd), 6);

  const db = getDb();
  const events = listCalendarEvents(db, gridStart, gridEnd);
  const host = (await headers()).get("host") ?? "127.0.0.1:3000";
  const port = host.split(":")[1] ?? "80";

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={<span className="capitalize">{formatDay(`${month}-01`, "MMMM yyyy")}</span>}
        description="Entretiens, dates limites et tâches"
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" asChild>
                <Link href={`/calendrier?mois=${shiftMonth(month, -1)}`} aria-label="Mois précédent">
                  <ChevronLeft />
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/calendrier">Aujourd&apos;hui</Link>
              </Button>
              <Button variant="outline" size="icon-sm" asChild>
                <Link href={`/calendrier?mois=${shiftMonth(month, 1)}`} aria-label="Mois suivant">
                  <ChevronRight />
                </Link>
              </Button>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <a href="/api/calendar/export">
                <Download /> .ics
              </a>
            </Button>
            <ConnectCalendarDialog
              feedPath={`/api/calendar/feed/${getCalendarToken(db)}.ics`}
              host={host}
              port={port}
              lanHosts={lanAddresses()}
            />
          </>
        }
      />
      <CalendarView month={month} today={today} gridStart={gridStart} gridEnd={gridEnd} events={events} />
    </div>
  );
}
