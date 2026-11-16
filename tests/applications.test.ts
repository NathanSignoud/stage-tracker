import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { applications, statusChanges, tasks } from "@/db/schema";
import {
  changeStatus,
  createApplication,
  getApplicationDetail,
  listApplications,
  markFollowedUp,
  updateApplication,
} from "@/server/services/applications";
import { getDashboard } from "@/server/services/dashboard";
import { createInteraction } from "@/server/services/interactions";
import { updateSettings } from "@/server/services/settings";
import { appInput, at, testDb } from "./helpers";

function tasksOf(db: ReturnType<typeof testDb>, applicationId: number) {
  return db.select().from(tasks).where(eq(tasks.applicationId, applicationId)).all();
}

describe("changements de statut", () => {
  it("historise chaque changement, y compris la création", () => {
    const db = testDb();
    const id = createApplication(db, appInput(), at("2026-10-01"));
    changeStatus(db, id, "to_apply", at("2026-10-02"));
    changeStatus(db, id, "to_apply", at("2026-10-03")); // sans effet
    changeStatus(db, id, "hr_interview", at("2026-10-04"));

    const history = db.select().from(statusChanges).where(eq(statusChanges.applicationId, id)).all();
    expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([
      [null, "to_explore"],
      ["to_explore", "to_apply"],
      ["to_apply", "hr_interview"],
    ]);
    expect(history[2].changedAt).toBe(at("2026-10-04").toISOString());
  });

  it("Envoyée → crée une relance à J+10 et renseigne la date d'envoi", () => {
    const db = testDb();
    const id = createApplication(db, appInput({ company: "Mistral" }), at("2026-10-01"));
    changeStatus(db, id, "sent", at("2026-10-05"));

    const app = db.select().from(applications).where(eq(applications.id, id)).get()!;
    expect(app.status).toBe("sent");
    expect(app.sentDate).toBe("2026-10-05");
    expect(tasksOf(db, id)).toMatchObject([
      { title: "Relancer Mistral", dueDate: "2026-10-15", origin: "auto_followup", doneAt: null },
    ]);
  });

  it("utilise le délai de relance configuré", () => {
    const db = testDb();
    updateSettings(db, { followUpDelayDays: 14 });
    const id = createApplication(db, appInput(), at("2026-10-01"));
    changeStatus(db, id, "sent", at("2026-10-01"));
    expect(tasksOf(db, id)[0].dueDate).toBe("2026-10-15");
  });

  it("une candidature créée directement en Envoyée a aussi sa relance", () => {
    const db = testDb();
    const id = createApplication(db, { ...appInput({ sentDate: "2026-09-30" }), status: "sent" }, at("2026-10-01"));
    expect(tasksOf(db, id)).toMatchObject([{ dueDate: "2026-10-10", origin: "auto_followup" }]);
  });

  it("aller-retour Envoyée ↔ Relancée : pas de relance en double", () => {
    const db = testDb();
    const id = createApplication(db, appInput(), at("2026-10-01"));
    changeStatus(db, id, "sent", at("2026-10-01"));
    changeStatus(db, id, "followed_up", at("2026-10-11"));
    changeStatus(db, id, "sent", at("2026-10-12"));

    const all = tasksOf(db, id);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ dueDate: "2026-10-11" });
    expect(all[0].doneAt).not.toBeNull();
    expect(all[1]).toMatchObject({ title: "Relancer Acme AI (2e relance)", dueDate: "2026-10-18", doneAt: null });
  });

  it("un entretien annule les relances en attente", () => {
    const db = testDb();
    const id = createApplication(db, appInput(), at("2026-10-01"));
    changeStatus(db, id, "sent", at("2026-10-01"));
    changeStatus(db, id, "hr_interview", at("2026-10-06"));
    const [task] = tasksOf(db, id);
    expect(task.cancelledAt).toBe(at("2026-10-06").toISOString());
    expect(task.doneAt).toBeNull();
  });

  it("corriger la date d'envoi recale la relance en attente", () => {
    const db = testDb();
    const id = createApplication(db, appInput(), at("2026-10-10"));
    changeStatus(db, id, "sent", at("2026-10-10"));
    updateApplication(db, id, appInput({ sentDate: "2026-10-03" }), at("2026-10-10"));
    expect(tasksOf(db, id)[0].dueDate).toBe("2026-10-13");
  });

  it("« J'ai relancé » depuis le tableau de bord", () => {
    const db = testDb();
    const id = createApplication(db, appInput(), at("2026-10-01"));
    changeStatus(db, id, "sent", at("2026-10-01"));
    markFollowedUp(db, id, at("2026-10-11"));
    expect(db.select().from(applications).where(eq(applications.id, id)).get()!.status).toBe("followed_up");

    // 2e relance faite : la tâche est cochée, aucune 3e n'est créée.
    markFollowedUp(db, id, at("2026-10-18"));
    const all = tasksOf(db, id);
    expect(all).toHaveLength(2);
    expect(all.every((t) => t.doneAt)).toBe(true);
  });

  it("refuse de modifier une candidature à la corbeille", () => {
    const db = testDb();
    const id = createApplication(db, appInput(), at("2026-10-01"));
    db.update(applications).set({ deletedAt: "2026-10-02T00:00:00.000Z" }).where(eq(applications.id, id)).run();
    expect(() => changeStatus(db, id, "sent")).toThrow("Candidature introuvable");
  });
});

describe("tags", () => {
  it("dédoublonne sans tenir compte de la casse et réutilise les tags existants", () => {
    const db = testDb();
    const a = createApplication(db, appInput({ tags: ["NLP", "nlp ", "Paris"] }));
    const b = createApplication(db, appInput({ tags: ["paris"] }));
    expect(getApplicationDetail(db, a)!.tags).toEqual(["NLP", "Paris"]);
    expect(getApplicationDetail(db, b)!.tags).toEqual(["Paris"]);
  });
});

describe("tableau de bord", () => {
  it("relances dues, sans nouvelles, dates limites et entretiens à venir", () => {
    const db = testDb();
    const now = at("2026-10-28");

    const due = createApplication(db, appInput({ company: "Relance due" }), at("2026-10-01"));
    changeStatus(db, due, "sent", at("2026-10-15"));

    const silent = createApplication(db, appInput({ company: "Silence" }), at("2026-10-01"));
    changeStatus(db, silent, "sent", at("2026-10-05"));
    markFollowedUp(db, silent, at("2026-10-15")); // relancée le 15, 2e relance le 22 (en retard)
    markFollowedUp(db, silent, at("2026-10-16")); // 2e relance faite
    const fresh = createApplication(db, appInput({ company: "Récente" }), at("2026-10-26"));
    changeStatus(db, fresh, "sent", at("2026-10-26"));

    createApplication(db, appInput({ company: "Deadline", deadline: "2026-11-02" }), now);
    createApplication(db, appInput({ company: "Trop tard", deadline: "2026-11-10" }), now);

    const interview = createApplication(db, { ...appInput({ company: "Entretien" }), status: "hr_interview" }, now);
    createInteraction(db, {
      applicationId: interview, contactId: null, date: "2026-10-30T14:00", type: "interview",
      summary: "Entretien RH", content: null, location: null, nextAction: null, nextActionDate: null,
    }, now);

    const d = getDashboard(db, now);
    expect(d.followUpsDue.map((t) => t.company)).toEqual(["Relance due"]);
    // « Relance due » est aussi sans nouvelles depuis 13 jours, mais n'est pas listée deux fois.
    expect(d.stale.map((a) => a.company)).toEqual(["Silence"]);
    expect(d.deadlines.map((a) => a.company)).toEqual(["Deadline"]);
    expect(d.appointments.map((i) => i.company)).toEqual(["Entretien"]);
    expect(d.sentThisWeek).toBe(1);
  });

  it("une candidature à la corbeille disparaît des listes et de ses tâches", () => {
    const db = testDb();
    const id = createApplication(db, appInput(), at("2026-10-01"));
    changeStatus(db, id, "sent", at("2026-10-01"));
    db.update(applications).set({ deletedAt: "2026-10-02T00:00:00.000Z" }).where(eq(applications.id, id)).run();
    const d = getDashboard(db, at("2026-10-20"));
    expect(d.followUpsDue).toEqual([]);
    expect(listApplications(db)).toEqual([]);
  });
});
