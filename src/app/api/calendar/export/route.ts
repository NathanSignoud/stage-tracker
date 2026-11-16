import { getDb } from "@/db";
import { localDate } from "@/lib/dates";
import { buildCalendar } from "@/lib/ics";
import { listIcsEvents } from "@/server/services/calendar";

/** Import ponctuel : tous les entretiens / appels et dates limites dans un seul fichier .ics. */
export function GET(request: Request) {
  const events = listIcsEvents(getDb(), new URL(request.url).origin);
  return new Response(buildCalendar(events, { name: "Stage Tracker" }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="stage-tracker-${localDate()}.ics"`,
    },
  });
}
