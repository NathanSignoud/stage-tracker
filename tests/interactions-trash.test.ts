import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tasks } from "@/db/schema";
import { createApplication, getApplicationDetail } from "@/server/services/applications";
import { createInteraction, updateInteraction, type InteractionData } from "@/server/services/interactions";
import { listTrash, moveToTrash, purgeFromTrash, restoreFromTrash } from "@/server/services/trash";
import { appInput, at, testDb } from "./helpers";

const exchange = (applicationId: number, overrides: Partial<InteractionData> = {}): InteractionData => ({
  applicationId,
  contactId: null,
  date: "2026-10-20T10:00",
  type: "call",
  summary: "Appel RH",
  content: null,
  location: null,
  nextAction: null,
  nextActionDate: null,
  ...overrides,
});

describe("prochaine action d'un échange", () => {
  it("crée une tâche liée, la met à jour, puis l'annule si l'action est retirée", () => {
    const db = testDb();
    const app = createApplication(db, appInput());
    const id = createInteraction(db, exchange(app, { nextAction: "Envoyer le portfolio", nextActionDate: "2026-10-22" }), at("2026-10-20"));

    const linked = () => db.select().from(tasks).where(eq(tasks.interactionId, id)).all();
    expect(linked()).toMatchObject([{ title: "Envoyer le portfolio", dueDate: "2026-10-22", origin: "interaction", applicationId: app }]);

    updateInteraction(db, id, exchange(app, { nextAction: "Envoyer le portfolio + GitHub", nextActionDate: "2026-10-23" }));
    expect(linked()).toHaveLength(1);
    expect(linked()[0]).toMatchObject({ title: "Envoyer le portfolio + GitHub", dueDate: "2026-10-23" });

    updateInteraction(db, id, exchange(app), at("2026-10-21"));
    expect(linked()[0].cancelledAt).toBe(at("2026-10-21").toISOString());
  });

  it("pas de tâche sans prochaine action", () => {
    const db = testDb();
    const app = createApplication(db, appInput());
    createInteraction(db, exchange(app));
    expect(db.select().from(tasks).all()).toEqual([]);
  });
});

describe("corbeille", () => {
  it("un échange part à la corbeille avec sa tâche, et revient avec elle", () => {
    const db = testDb();
    const app = createApplication(db, appInput());
    const id = createInteraction(db, exchange(app, { nextAction: "Rappeler" }));

    moveToTrash(db, "interaction", id, at("2026-10-21"));
    expect(getApplicationDetail(db, app)!.interactions).toEqual([]);
    expect(getApplicationDetail(db, app)!.tasks).toEqual([]);
    expect(listTrash(db).map((i) => i.kind)).toEqual(["interaction"]);

    restoreFromTrash(db, "interaction", id);
    expect(getApplicationDetail(db, app)!.interactions).toHaveLength(1);
    expect(getApplicationDetail(db, app)!.tasks).toHaveLength(1);
  });

  it("ne supprime définitivement que ce qui est déjà dans la corbeille", () => {
    const db = testDb();
    const app = createApplication(db, appInput());
    expect(() => purgeFromTrash(db, "application", app)).toThrow(/corbeille/);

    moveToTrash(db, "application", app);
    purgeFromTrash(db, "application", app);
    expect(getApplicationDetail(db, app)).toBeNull();
    expect(listTrash(db)).toEqual([]);
  });
});
