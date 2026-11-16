import crypto from "node:crypto";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Conn } from "@/db";
import { applications, contacts, interactions, tasks } from "@/db/schema";
import { addDays, localDate } from "@/lib/dates";
import {
  DEFAULT_INTERVIEW_MINUTES,
  INTERACTION_LABELS,
  INTERVIEW_KIND_LABELS,
  STATUS_INTERVIEW_KINDS,
  type InteractionType,
  type InterviewKind,
  type Status,
} from "@/lib/domain/constants";
import { sequenceFrom, type IcsEvent } from "@/lib/ics";
import { openTask } from "./applications";
import { getRawSetting, setSetting } from "./settings";

export const CALENDAR_EVENT_KINDS = ["interview", "deadline", "task"] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

/** Types d'échange qui sont des rendez-vous (affichés dans le calendrier). */
const MEETING_TYPES: InteractionType[] = ["interview", "call", "meeting"];

export type CalendarEvent = {
  key: string;
  kind: CalendarEventKind;
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm`, null pour une journée entière. */
  time: string | null;
  durationMinutes: number | null;
  title: string;
  company: string | null;
  applicationId: number | null;
  interactionId: number | null;
  location: string | null;
  contactName: string | null;
};

export function interviewLabel(type: InteractionType, kind: InterviewKind | null): string {
  if (type === "interview") return INTERVIEW_KIND_LABELS[kind ?? "other"];
  return INTERACTION_LABELS[type];
}

/** Entretiens / appels, dates limites et tâches entre deux dates (incluses). */
export function listCalendarEvents(
  conn: Conn,
  from: string,
  to: string,
  kinds: readonly CalendarEventKind[] = CALENDAR_EVENT_KINDS,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  if (kinds.includes("interview")) {
    for (const r of conn
      .select({ i: interactions, company: applications.company, appDeleted: applications.deletedAt, contactName: contacts.name })
      .from(interactions)
      .leftJoin(applications, eq(applications.id, interactions.applicationId))
      .leftJoin(contacts, eq(contacts.id, interactions.contactId))
      .where(
        and(
          isNull(interactions.deletedAt),
          inArray(interactions.type, MEETING_TYPES),
          gte(interactions.date, `${from}T00:00`),
          lte(interactions.date, `${to}T23:59`),
        ),
      )
      .all()) {
      if (r.appDeleted) continue;
      events.push({
        key: `i${r.i.id}`,
        kind: "interview",
        date: r.i.date.slice(0, 10),
        time: r.i.date.slice(11, 16),
        durationMinutes: r.i.durationMinutes,
        title: interviewLabel(r.i.type, r.i.interviewKind),
        company: r.company,
        applicationId: r.i.applicationId,
        interactionId: r.i.id,
        location: r.i.location,
        contactName: r.contactName,
      });
    }
  }

  if (kinds.includes("deadline")) {
    for (const a of conn
      .select()
      .from(applications)
      .where(
        and(
          isNull(applications.deletedAt),
          inArray(applications.status, ["to_explore", "to_apply"]),
          gte(applications.deadline, from),
          lte(applications.deadline, to),
        ),
      )
      .all()) {
      events.push({
        key: `d${a.id}`,
        kind: "deadline",
        date: a.deadline!,
        time: null,
        durationMinutes: null,
        title: "Date limite",
        company: a.company,
        applicationId: a.id,
        interactionId: null,
        location: null,
        contactName: null,
      });
    }
  }

  if (kinds.includes("task")) {
    for (const r of conn
      .select({ t: tasks, company: applications.company, appDeleted: applications.deletedAt })
      .from(tasks)
      .leftJoin(applications, eq(applications.id, tasks.applicationId))
      .where(and(openTask, gte(tasks.dueDate, from), lte(tasks.dueDate, to)))
      .all()) {
      if (r.appDeleted) continue;
      events.push({
        key: `t${r.t.id}`,
        kind: "task",
        date: r.t.dueDate!,
        time: null,
        durationMinutes: null,
        title: r.t.title,
        company: r.company,
        applicationId: r.t.applicationId,
        interactionId: null,
        location: null,
        contactName: null,
      });
    }
  }

  return events.sort((a, b) => `${a.date}${a.time ?? "00:00"}`.localeCompare(`${b.date}${b.time ?? "00:00"}`));
}

/**
 * Candidatures au stade « Entretien RH » ou « Entretien technique » sans entretien
 * correspondant planifié : il faut y mettre une date.
 */
export function interviewsToSchedule(conn: Conn) {
  const pending = conn
    .select()
    .from(applications)
    .where(and(isNull(applications.deletedAt), inArray(applications.status, Object.keys(STATUS_INTERVIEW_KINDS) as Status[])))
    .all();
  if (!pending.length) return [];
  const scheduled = conn
    .select({ applicationId: interactions.applicationId, kind: interactions.interviewKind })
    .from(interactions)
    .where(
      and(
        isNull(interactions.deletedAt),
        eq(interactions.type, "interview"),
        inArray(interactions.applicationId, pending.map((a) => a.id)),
      ),
    )
    .all();
  return pending
    .filter((a) => {
      const expected = STATUS_INTERVIEW_KINDS[a.status as Status] ?? [];
      // Un entretien sans type précisé (créé avant cette fonctionnalité) compte pour n'importe quel stade.
      return !scheduled.some((s) => s.applicationId === a.id && (!s.kind || expected.includes(s.kind)));
    })
    .map((a) => ({
      id: a.id,
      company: a.company,
      title: a.title,
      status: a.status,
      kind: (STATUS_INTERVIEW_KINDS[a.status]?.[0] ?? "other") as InterviewKind,
    }));
}

export type InterviewToSchedule = ReturnType<typeof interviewsToSchedule>[number];

// --- Export iCalendar --------------------------------------------------------

type MeetingRow = {
  i: typeof interactions.$inferSelect;
  company: string | null;
  title: string | null;
  contactName: string | null;
};

function meetingToIcs(r: MeetingRow, baseUrl: string): IcsEvent {
  const label = interviewLabel(r.i.type, r.i.interviewKind);
  const ficheUrl = r.i.applicationId ? `${baseUrl}/candidatures/${r.i.applicationId}` : null;
  const description = [
    r.title && `Poste : ${r.title}`,
    r.contactName && `Contact : ${r.contactName}`,
    r.i.summary !== label && r.i.summary,
    r.i.content && r.i.content.slice(0, 1500),
    ficheUrl && `Fiche : ${ficheUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
  const isInterview = r.i.type === "interview";
  return {
    uid: `interaction-${r.i.id}@stage-tracker`,
    start: r.i.date,
    durationMinutes: r.i.durationMinutes ?? (isInterview ? DEFAULT_INTERVIEW_MINUTES : 30),
    title: r.company ? `${label} · ${r.company}` : label,
    description,
    location: r.i.location,
    url: ficheUrl,
    sequence: sequenceFrom(r.i.updatedAt),
    // Rappels : la veille (pour préparer) et 1 h avant pour un entretien ; 15 min avant pour un appel.
    alarms: isInterview ? [24 * 60, 60] : [15],
  };
}

function meetingQuery(conn: Conn) {
  return conn
    .select({ i: interactions, company: applications.company, title: applications.title, appDeleted: applications.deletedAt, contactName: contacts.name })
    .from(interactions)
    .leftJoin(applications, eq(applications.id, interactions.applicationId))
    .leftJoin(contacts, eq(contacts.id, interactions.contactId));
}

/** Événements exportés : entretiens et appels (90 derniers jours → futur) + dates limites à venir. */
export function listIcsEvents(conn: Conn, baseUrl: string, now = new Date()): IcsEvent[] {
  const today = localDate(now);
  const meetings = meetingQuery(conn)
    .where(
      and(
        isNull(interactions.deletedAt),
        inArray(interactions.type, MEETING_TYPES),
        gte(interactions.date, `${addDays(today, -90)}T00:00`),
      ),
    )
    .all()
    .filter((r) => !r.appDeleted)
    .map((r) => meetingToIcs(r, baseUrl));

  const deadlines: IcsEvent[] = listCalendarEvents(conn, today, addDays(today, 365), ["deadline"]).map((e) => ({
    uid: `deadline-${e.applicationId}@stage-tracker`,
    start: e.date,
    allDay: true,
    title: `Date limite · ${e.company}`,
    url: `${baseUrl}/candidatures/${e.applicationId}`,
  }));

  return [...meetings, ...deadlines];
}

/** Un seul entretien / appel, pour le bouton « Ajouter à mon agenda ». */
export function getInteractionIcsEvent(conn: Conn, interactionId: number, baseUrl: string): IcsEvent | null {
  const row = meetingQuery(conn).where(eq(interactions.id, interactionId)).get();
  if (!row || row.i.deletedAt) return null;
  return meetingToIcs(row, baseUrl);
}

// --- Jeton de l'abonnement ----------------------------------------------------

const TOKEN_KEY = "calendarToken";

/** Jeton secret de l'URL d'abonnement (créé au premier besoin). */
export function getCalendarToken(conn: Conn): string {
  const existing = getRawSetting<string>(conn, TOKEN_KEY);
  if (existing) return existing;
  return regenerateCalendarToken(conn);
}

export function regenerateCalendarToken(conn: Conn): string {
  const token = crypto.randomBytes(18).toString("base64url");
  setSetting(conn, TOKEN_KEY, token);
  return token;
}

export function isValidCalendarToken(conn: Conn, candidate: string): boolean {
  const expected = getRawSetting<string>(conn, TOKEN_KEY);
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // Longueur en octets (pas en caractères) : timingSafeEqual lève une erreur si elles diffèrent.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
