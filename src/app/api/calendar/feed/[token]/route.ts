import { getDb } from "@/db";
import { buildCalendar } from "@/lib/ics";
import { isValidCalendarToken, listIcsEvents } from "@/server/services/calendar";

/**
 * Abonnement (webcal) pour Apple Calendrier / Outlook. Authentifié par le jeton secret de l'URL,
 * seul moyen possible pour une application d'agenda (laissé passer par src/proxy.ts).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/calendar/feed/[token]">) {
  const { token } = await params;
  const db = getDb();
  if (!isValidCalendarToken(db, token.replace(/\.ics$/, ""))) return new Response("Introuvable", { status: 404 });
  const ics = buildCalendar(listIcsEvents(db, new URL(request.url).origin), {
    name: "Stage Tracker — entretiens",
    refreshMinutes: 60,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
