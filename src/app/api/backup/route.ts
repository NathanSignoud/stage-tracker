import { getDb } from "@/db";
import { exportDatabase } from "@/lib/backup";
import { localDate } from "@/lib/dates";

/** Téléchargement de l'état actuel de la base, au même format que `npm run backup`. */
export function GET() {
  const backup = exportDatabase(getDb().$client);
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="stage-tracker-${localDate()}.json"`,
    },
  });
}
