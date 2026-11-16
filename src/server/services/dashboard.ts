import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { Conn } from "@/db";
import { applications, contacts, interactions, statusChanges, tasks } from "@/db/schema";
import { addDays, isoToLocalDate, localDate, localDateTime, startOfWeek } from "@/lib/dates";
import { APPOINTMENT_TYPES, CLOSED_STATUSES, DEFAULT_INTERVIEW_MINUTES, INTERVIEW_STATUSES, OPEN_STATUSES, type Status } from "@/lib/domain/constants";
import { listApplications, openTask } from "./applications";
import { interviewsToSchedule, listCalendarEvents } from "./calendar";
import { getSettings } from "./settings";

/** Statuts qui signifient « l'entreprise a répondu ». */
const RESPONSE_STATUSES: Status[] = [...INTERVIEW_STATUSES, "offer", "accepted", "rejected"];
const WEEKS_OF_SENDS = 8;
const WEEKS_OF_ACTIVITY = 12;

export function getDashboard(conn: Conn, now = new Date()) {
  const today = localDate(now);
  const inAWeek = addDays(today, 7);
  const settings = getSettings(conn);

  const openTasks = conn
    .select({ task: tasks, company: applications.company, status: applications.status })
    .from(tasks)
    .leftJoin(applications, eq(applications.id, tasks.applicationId))
    .where(and(openTask, isNull(applications.deletedAt)))
    .orderBy(asc(tasks.dueDate))
    .all()
    .map((r) => ({ ...r.task, company: r.company, applicationStatus: r.status }));

  const followUpsDue = openTasks.filter(
    (t) => t.origin === "auto_followup" && t.dueDate && t.dueDate <= today,
  );
  const tasksDue = openTasks.filter(
    (t) => t.origin !== "auto_followup" && t.dueDate && t.dueDate <= today,
  );
  const tasksSoon = openTasks.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= inAWeek);

  const appointments = conn
    .select({ interaction: interactions, company: applications.company, contactName: contacts.name })
    .from(interactions)
    .leftJoin(applications, eq(applications.id, interactions.applicationId))
    .leftJoin(contacts, eq(contacts.id, interactions.contactId))
    .where(
      and(
        isNull(interactions.deletedAt),
        isNull(applications.deletedAt),
        inArray(interactions.type, [...APPOINTMENT_TYPES]),
        gte(interactions.date, `${today}T00:00`),
      ),
    )
    .orderBy(asc(interactions.date))
    .all()
    .map((r) => ({ ...r.interaction, company: r.company, contactName: r.contactName }));

  const allApps = listApplications(conn, now);
  const deadlines = allApps
    .filter(
      (a) =>
        (a.status === "to_explore" || a.status === "to_apply") &&
        a.deadline &&
        a.deadline >= today &&
        a.deadline <= inAWeek,
    )
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!));

  const followUpAppIds = new Set(followUpsDue.map((t) => t.applicationId));
  const stale = allApps
    .filter((a) => a.stale && !followUpAppIds.has(a.id))
    .sort((a, b) => (a.lastActivity ?? "").localeCompare(b.lastActivity ?? ""));

  const countsByStatus = Object.fromEntries(OPEN_STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const a of allApps) if (a.status in countsByStatus) countsByStatus[a.status]++;

  const weekStart = startOfWeek(today);
  const sentThisWeek = allApps.filter((a) => a.sentDate && a.sentDate >= weekStart && a.sentDate <= today).length;

  // Envois par semaine (lundi → dimanche), la semaine en cours en dernier.
  const weeklySent = Array.from({ length: WEEKS_OF_SENDS }, (_, i) => {
    const start = addDays(weekStart, -7 * (WEEKS_OF_SENDS - 1 - i));
    const end = addDays(start, 6);
    return { weekStart: start, count: allApps.filter((a) => a.sentDate && a.sentDate >= start && a.sentDate <= end).length };
  });

  // Historique des statuts : taux de réponse et carte d'activité.
  const liveIds = new Set(allApps.map((a) => a.id));
  const history = conn.select().from(statusChanges).all().filter((h) => liveIds.has(h.applicationId));
  const reached = new Map<number, Set<Status>>();
  for (const h of history) reached.set(h.applicationId, (reached.get(h.applicationId) ?? new Set()).add(h.toStatus));
  const sentApps = allApps.filter(
    (a) => a.sentDate || [...(reached.get(a.id) ?? [])].some((s) => s !== "to_explore" && s !== "to_apply" && s !== "abandoned"),
  );
  const responded = sentApps.filter((a) => [...(reached.get(a.id) ?? [])].some((s) => RESPONSE_STATUSES.includes(s))).length;

  const activityStart = addDays(weekStart, -7 * (WEEKS_OF_ACTIVITY - 1));
  const activityByDay = new Map<string, number>();
  const bump = (day: string) => activityByDay.set(day, (activityByDay.get(day) ?? 0) + 1);
  for (const h of history) bump(isoToLocalDate(h.changedAt));
  for (const i of conn
    .select({ date: interactions.date, applicationId: interactions.applicationId })
    .from(interactions)
    .where(and(isNull(interactions.deletedAt), gte(interactions.date, `${activityStart}T00:00`)))
    .all()) {
    if (i.date <= localDateTime(now) && (!i.applicationId || liveIds.has(i.applicationId))) bump(i.date.slice(0, 10));
  }
  const activity = Array.from({ length: WEEKS_OF_ACTIVITY * 7 }, (_, i) => {
    const date = addDays(activityStart, i);
    return { date, count: date > today ? null : (activityByDay.get(date) ?? 0) };
  });

  // Les 7 prochains jours (aujourd'hui inclus) pour la frise de la semaine.
  const upcoming = listCalendarEvents(conn, today, addDays(today, 6));
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    return { date, events: upcoming.filter((e) => e.date === date) };
  });

  // Un rendez-vous reste « à venir » jusqu'à sa fin (durée, 1 h par défaut) : on en a besoin pendant qu'il a lieu.
  const nowLocal = localDateTime(now);
  const upcomingAppointments = appointments.filter((a) => {
    const end = new Date(new Date(a.date).getTime() + (a.durationMinutes ?? DEFAULT_INTERVIEW_MINUTES) * 60_000);
    return localDateTime(end) > nowLocal;
  });
  const nextInterview = upcomingAppointments.find((a) => a.type === "interview") ?? upcomingAppointments[0] ?? null;

  return {
    today,
    followUpsDue,
    tasksDue,
    tasksSoon,
    appointments,
    upcomingAppointments,
    deadlines,
    stale,
    countsByStatus,
    sentThisWeek,
    weeklyGoal: settings.weeklyGoal,
    staleAfterDays: settings.staleAfterDays,
    nextInterview,
    toSchedule: interviewsToSchedule(conn),
    week,
    weeklySent,
    activity,
    responses: { sent: sentApps.length, responded },
    totals: {
      active: allApps.filter((a) => !CLOSED_STATUSES.includes(a.status)).length,
      inInterview: allApps.filter((a) => INTERVIEW_STATUSES.includes(a.status)).length,
      offers: allApps.filter((a) => a.status === "offer" || a.status === "accepted").length,
      closed: allApps.filter((a) => CLOSED_STATUSES.includes(a.status)).length,
    },
    closedByStatus: {
      accepted: allApps.filter((a) => a.status === "accepted").length,
      rejected: allApps.filter((a) => a.status === "rejected").length,
      abandoned: allApps.filter((a) => a.status === "abandoned").length,
    },
  };
}

export type Dashboard = ReturnType<typeof getDashboard>;
