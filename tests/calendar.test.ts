import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { applications } from "@/db/schema";
import { buildCalendar, escapeText, foldLine } from "@/lib/ics";
import { changeStatus, createApplication } from "@/server/services/applications";
import {
  getCalendarToken,
  getInteractionIcsEvent,
  interviewsToSchedule,
  isValidCalendarToken,
  listCalendarEvents,
  listIcsEvents,
  regenerateCalendarToken,
} from "@/server/services/calendar";
import { getDashboard } from "@/server/services/dashboard";
import { createInteraction, type InteractionData } from "@/server/services/interactions";
import { moveToTrash } from "@/server/services/trash";
import { appInput, at, testDb } from "./helpers";

const interview = (applicationId: number, overrides: Partial<InteractionData> = {}): InteractionData => ({
  applicationId,
  contactId: null,
  date: "2026-11-03T14:30",
  type: "interview",
  interviewKind: "hr",
  durationMinutes: 45,
  summary: "Entretien RH",
  content: null,
  location: "Teams",
  nextAction: null,
  nextActionDate: null,
  ...overrides,
});

const statusOf = (db: ReturnType<typeof testDb>, id: number) =>
  db.select().from(applications).where(eq(applications.id, id)).get()!.status;

describe("entretiens", () => {
  it("planifier un entretien RH fait avancer une candidature envoyée", () => {
    const db = testDb();
    const id = createApplication(db, appInput(), at("2026-10-01"));
    changeStatus(db, id, "sent", at("2026-10-01"));
    createInteraction(db, interview(id, { interviewKind: "test", date: "2026-10-18T10:00" }), at("2026-10-19"));
    expect(statusOf(db, id)).toBe("tech_test");

    createInteraction(db, interview(id), at("2026-10-20"));
    expect(statusOf(db, id)).toBe("hr_interview");

    createInteraction(db, interview(id, { interviewKind: "tech", date: "2026-11-14T10:00" }), at("2026-10-22"));
    expect(statusOf(db, id)).toBe("tech_interview");

    // Jamais de retour en arrière.
    createInteraction(db, interview(id, { interviewKind: "test", date: "2026-11-16T10:00" }), at("2026-10-23"));
    createInteraction(db, interview(id, { interviewKind: "hr", date: "2026-11-17T10:00" }), at("2026-10-24"));
    expect(statusOf(db, id)).toBe("tech_interview");
  });

  it("ne touche pas à une candidature clôturée", () => {
    const db = testDb();
    const id = createApplication(db, { ...appInput(), status: "rejected" });
    createInteraction(db, interview(id));
    expect(statusOf(db, id)).toBe("rejected");
  });

  it("liste les candidatures en entretien sans date planifiée", () => {
    const db = testDb();
    const hr = createApplication(db, { ...appInput({ company: "RH sans date" }), status: "hr_interview" });
    const tech = createApplication(db, { ...appInput({ company: "Tech" }), status: "hr_interview" });
    createInteraction(db, interview(tech));
    expect(interviewsToSchedule(db).map((a) => [a.company, a.kind])).toEqual([["RH sans date", "hr"]]);

    // Un test technique se fait sans créneau : rien à planifier.
    const test = createApplication(db, { ...appInput({ company: "Test" }), status: "tech_test" });
    expect(interviewsToSchedule(db).map((a) => a.id)).not.toContain(test);

    // Passée en technique, la candidature attend maintenant un entretien technique.
    changeStatus(db, tech, "tech_interview");
    expect(interviewsToSchedule(db).map((a) => [a.company, a.kind])).toEqual([
      ["RH sans date", "hr"],
      ["Tech", "tech"],
    ]);
    createInteraction(db, interview(hr));
    createInteraction(db, interview(tech, { interviewKind: "tech" }));
    expect(interviewsToSchedule(db)).toEqual([]);
  });
});

describe("calendrier", () => {
  it("rassemble entretiens, dates limites et tâches sur la période", () => {
    const db = testDb();
    const a = createApplication(db, appInput({ company: "Mistral", deadline: "2026-11-05" }));
    createInteraction(db, interview(a, { nextAction: "Préparer", nextActionDate: "2026-11-02" }));
    createInteraction(db, interview(a, { date: "2026-12-01T10:00" })); // hors période

    const events = listCalendarEvents(db, "2026-11-01", "2026-11-30");
    expect(events.map((e) => [e.kind, e.date, e.time, e.title])).toEqual([
      ["task", "2026-11-02", null, "Préparer"],
      ["interview", "2026-11-03", "14:30", "Entretien RH"],
      ["task", "2026-11-04", null, "Envoyer un remerciement à Mistral"],
      // Passée en entretien RH, la date limite de candidature ne s'affiche plus ; la relance J+7
      // du 1er entretien a été annulée par le 2e (hors période).
    ]);

    db.update(applications).set({ status: "to_apply" }).where(eq(applications.id, a)).run();
    expect(listCalendarEvents(db, "2026-11-01", "2026-11-30", ["deadline"]).map((e) => e.company)).toEqual(["Mistral"]);

    moveToTrash(db, "application", a);
    expect(listCalendarEvents(db, "2026-11-01", "2026-11-30")).toEqual([]);
  });

  it("la frise du tableau de bord couvre les 7 prochains jours", () => {
    const db = testDb();
    const a = createApplication(db, appInput());
    createInteraction(db, interview(a, { date: "2026-10-30T09:00" }), at("2026-10-28"));
    const d = getDashboard(db, at("2026-10-28"));
    expect(d.week.map((w) => w.date)).toEqual([
      "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03",
    ]);
    expect(d.week[2].events.map((e) => e.title)).toEqual(["Entretien RH"]);
    expect(d.nextInterview?.date).toBe("2026-10-30T09:00");
    expect(d.weeklySent).toHaveLength(8);
    expect(d.activity).toHaveLength(84);
  });

  it("le prochain entretien reste affiché jusqu'à sa fin", () => {
    const db = testDb();
    const a = createApplication(db, appInput());
    createInteraction(db, interview(a, { date: "2026-11-12T10:00", durationMinutes: 45 }), at("2026-11-01"));
    expect(getDashboard(db, at("2026-11-12", "10:30")).nextInterview?.date).toBe("2026-11-12T10:00");
    expect(getDashboard(db, at("2026-11-12", "10:50")).nextInterview).toBeNull();
  });
});

describe("export iCalendar", () => {
  it("échappe le texte et replie les lignes longues sans couper un caractère", () => {
    expect(escapeText("Entretien; RH, Paris\nNotes \\ ok")).toBe("Entretien\\; RH\\, Paris\\nNotes \\\\ ok");
    const folded = foldLine(`DESCRIPTION:${"é".repeat(80)}`);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(lines.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(`DESCRIPTION:${"é".repeat(80)}`);
  });

  it("produit un VEVENT en UTC avec fin, rappels et lien vers la fiche", () => {
    const db = testDb();
    const a = createApplication(db, appInput({ company: "Hugging Face", title: "Stage NLP" }));
    const id = createInteraction(db, interview(a));
    const event = getInteractionIcsEvent(db, id, "http://127.0.0.1:3000")!;
    const ics = buildCalendar([event], { name: "Test", now: new Date("2026-10-28T10:00:00Z") });

    const start = new Date("2026-11-03T14:30"); // heure locale du PC
    const end = new Date(start.getTime() + 45 * 60_000);
    const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    expect(ics).toContain(`DTSTART:${utc(start)}`);
    expect(ics).toContain(`DTEND:${utc(end)}`);
    expect(ics).toContain("SUMMARY:Entretien RH · Hugging Face");
    expect(ics).toContain("LOCATION:Teams");
    expect(ics).toContain(`UID:interaction-${id}@stage-tracker`);
    expect(ics).toContain("TRIGGER:-PT1440M");
    expect(ics).toContain("TRIGGER:-PT60M");
    expect(ics).toContain(`URL:http://127.0.0.1:3000/candidatures/${a}`);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("l'abonnement contient entretiens et dates limites (journée entière)", () => {
    const db = testDb();
    const a = createApplication(db, appInput({ company: "Owkin", deadline: "2026-11-15" }));
    createInteraction(db, interview(a, { type: "call", interviewKind: null, durationMinutes: null }));
    const events = listIcsEvents(db, "http://x", at("2026-10-28"));
    expect(events.map((e) => [e.title, e.allDay ?? false, e.durationMinutes])).toEqual([
      ["Appel · Owkin", false, 30],
      ["Date limite · Owkin", true, undefined],
    ]);
    expect(buildCalendar(events, { name: "x" })).toContain("DTSTART;VALUE=DATE:20261115");
  });

  it("jeton d'abonnement : créé une fois, vérifié, régénérable", () => {
    const db = testDb();
    const token = getCalendarToken(db);
    expect(getCalendarToken(db)).toBe(token);
    expect(isValidCalendarToken(db, token)).toBe(true);
    expect(isValidCalendarToken(db, token.slice(0, -1) + (token.endsWith("x") ? "y" : "x"))).toBe(false);
    const next = regenerateCalendarToken(db);
    expect(isValidCalendarToken(db, token)).toBe(false);
    expect(isValidCalendarToken(db, next)).toBe(true);
  });
});
