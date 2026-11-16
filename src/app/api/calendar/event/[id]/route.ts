import { getDb } from "@/db";
import { buildCalendar } from "@/lib/ics";
import { normalizeText } from "@/lib/text";
import { getInteractionIcsEvent } from "@/server/services/calendar";

/** « Ajouter à mon agenda » : un seul entretien, à ouvrir avec Outlook / Apple Calendrier. */
export async function GET(request: Request, { params }: RouteContext<"/api/calendar/event/[id]">) {
  const { id } = await params;
  const event = getInteractionIcsEvent(getDb(), Number(id), new URL(request.url).origin);
  if (!event) return new Response("Entretien introuvable", { status: 404 });
  const slug = normalizeText(event.title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response(buildCalendar([event], { name: "Stage Tracker" }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug || "entretien"}-${event.start.slice(0, 10)}.ics"`,
    },
  });
}
