import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tasks } from "@/db/schema";
import { changeStatus, createApplication } from "@/server/services/applications";
import { createInteraction, updateInteraction, type InteractionData } from "@/server/services/interactions";
import { updateSettings } from "@/server/services/settings";
import { moveToTrash } from "@/server/services/trash";
import { appInput, at, testDb } from "./helpers";

const interview = (applicationId: number, date: string, overrides: Partial<InteractionData> = {}): InteractionData => ({
  applicationId,
  contactId: null,
  date,
  type: "interview",
  interviewKind: "hr",
  durationMinutes: 45,
  summary: "Entretien RH",
  content: null,
  location: null,
  nextAction: null,
  nextActionDate: null,
  ...overrides,
});

function postInterviewTasks(db: ReturnType<typeof testDb>, applicationId: number) {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.applicationId, applicationId), inArray(tasks.origin, ["thank_you", "auto_followup"])))
    .all();
}

describe("après l'entretien", () => {
  it("remerciement le lendemain et relance à J+7, liés à l'entretien", () => {
    const db = testDb();
    const app = createApplication(db, appInput({ company: "Mistral" }), at("2026-10-01"));
    changeStatus(db, app, "sent", at("2026-10-01"));
    const id = createInteraction(db, interview(app, "2026-11-04T14:00"), at("2026-10-28"));

    const open = postInterviewTasks(db, app).filter((t) => !t.cancelledAt);
    expect(open.map((t) => [t.origin, t.title, t.dueDate, t.interactionId])).toEqual([
      ["thank_you", "Envoyer un remerciement à Mistral", "2026-11-05", id],
      ["auto_followup", "Relancer Mistral après l'entretien", "2026-11-11", id],
    ]);
    // La relance « candidature envoyée » a été annulée par le passage en entretien.
    expect(postInterviewTasks(db, app).filter((t) => t.cancelledAt).map((t) => t.title)).toEqual(["Relancer Mistral"]);
  });

  it("déplacer l'entretien déplace les tâches", () => {
    const db = testDb();
    const app = createApplication(db, appInput());
    const id = createInteraction(db, interview(app, "2026-11-04T14:00"));
    updateInteraction(db, id, interview(app, "2026-11-10T09:00"));
    expect(postInterviewTasks(db, app).map((t) => t.dueDate)).toEqual(["2026-11-11", "2026-11-17"]);
  });

  it("un nouvel entretien annule la relance du précédent ; un changement de statut aussi", () => {
    const db = testDb();
    const app = createApplication(db, { ...appInput(), status: "hr_interview" });
    createInteraction(db, interview(app, "2026-11-04T14:00"), at("2026-10-28"));
    createInteraction(db, interview(app, "2026-11-18T10:00", { interviewKind: "tech" }), at("2026-11-06"));
    const relances = postInterviewTasks(db, app).filter((t) => t.origin === "auto_followup");
    expect(relances.map((t) => [t.dueDate, t.cancelledAt !== null])).toEqual([
      ["2026-11-11", true],
      ["2026-11-25", false],
    ]);

    changeStatus(db, app, "offer", at("2026-11-20"));
    expect(postInterviewTasks(db, app).filter((t) => t.origin === "auto_followup" && !t.cancelledAt)).toEqual([]);
  });

  it("respecte les réglages (désactivation)", () => {
    const db = testDb();
    updateSettings(db, { thankYouReminder: false, postInterviewFollowUpDays: 0 });
    const app = createApplication(db, appInput());
    createInteraction(db, interview(app, "2026-11-04T14:00"));
    expect(postInterviewTasks(db, app)).toEqual([]);
  });

  it("un appel ne crée rien ; un entretien mis à la corbeille emporte ses tâches", () => {
    const db = testDb();
    const app = createApplication(db, appInput());
    createInteraction(db, interview(app, "2026-11-04T14:00", { type: "call", interviewKind: null }));
    expect(postInterviewTasks(db, app)).toEqual([]);

    const id = createInteraction(db, interview(app, "2026-11-05T14:00"));
    moveToTrash(db, "interaction", id);
    expect(postInterviewTasks(db, app).every((t) => t.deletedAt)).toBe(true);
  });
});
