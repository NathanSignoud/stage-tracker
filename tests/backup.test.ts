import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportDatabase, importDatabase, parseBackup, rotateBackups, writeBackup } from "@/lib/backup";
import { changeStatus, createApplication, getApplicationDetail, listApplications } from "@/server/services/applications";
import { listContacts } from "@/server/services/contacts";
import { listKeywords } from "@/server/services/keywords";
import { getSettings, updateSettings } from "@/server/services/settings";
import { listTemplates } from "@/server/services/templates";
import { seedIfNeeded } from "@/server/seed";
import { appInput, at, testDb } from "./helpers";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "stage-tracker-"));
}

describe("sauvegarde / restauration", () => {
  it("aller-retour JSON sans perte", () => {
    const source = testDb();
    seedIfNeeded(source, at("2026-10-28"));
    const id = createApplication(source, appInput({ company: "Hugging Face", tags: ["NLP"] }), at("2026-10-01"));
    changeStatus(source, id, "sent", at("2026-10-02"));
    updateSettings(source, { weeklyGoal: 8 });

    const json = JSON.stringify(exportDatabase(source.$client));
    const target = testDb();
    createApplication(target, appInput({ company: "À écraser" }));
    const report = importDatabase(target.$client, parseBackup(json));

    expect(report.ignoredTables).toEqual([]);
    expect(report.ignoredColumns).toEqual([]);
    expect(listApplications(target, at("2026-10-28"))).toEqual(listApplications(source, at("2026-10-28")));
    expect(listContacts(target)).toEqual(listContacts(source));
    expect(getApplicationDetail(target, id)).toEqual(getApplicationDetail(source, id));
    expect(getSettings(target).weeklyGoal).toBe(8);
    expect(exportDatabase(target.$client, at("2026-10-28")).tables).toEqual(
      exportDatabase(source.$client, at("2026-10-28")).tables,
    );

    // Les identifiants auto-incrémentés repartent après les lignes restaurées.
    const next = createApplication(target, appInput({ company: "Nouvelle" }));
    expect(next).toBeGreaterThan(id);
  });

  it("restaure une sauvegarde contenant une colonne ou une table qui n'existe plus", () => {
    const db = testDb();
    const backup = exportDatabase(db.$client);
    backup.tables.tags = [{ id: 1, name: "ML", couleur: "bleu" }];
    backup.tables.ancienne_table = [{ id: 1 }];
    const report = importDatabase(db.$client, backup);
    expect(report.ignoredColumns).toEqual(["tags.couleur"]);
    expect(report.ignoredTables).toEqual(["ancienne_table"]);
  });

  it("refuse un fichier qui n'est pas une sauvegarde", () => {
    expect(() => parseBackup('{"hello": 1}')).toThrow(/sauvegarde/);
  });

  it("garde les 10 dernières sauvegardes automatiques, sans toucher aux manuelles", () => {
    const db = testDb();
    const dir = tempDir();
    for (let i = 0; i < 12; i++) writeBackup(db.$client, dir, "auto", new Date(2026, 9, 1 + i, 9));
    writeBackup(db.$client, dir, "backup", new Date(2026, 8, 1, 9));

    const removed = rotateBackups(dir, "auto", 10);
    const files = fs.readdirSync(dir).sort();
    expect(removed).toEqual(["auto-2026-10-02_09-00-00.json", "auto-2026-10-01_09-00-00.json"]);
    expect(files.filter((f) => f.startsWith("auto-"))).toHaveLength(10);
    expect(files).toContain("backup-2026-09-01_09-00-00.json");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("données de départ", () => {
  it("sont appliquées une seule fois", () => {
    const db = testDb();
    expect(seedIfNeeded(db, at("2026-10-28"))).not.toEqual([]);
    expect(seedIfNeeded(db, at("2026-10-29"))).toEqual([]);

    // Base neuve : aucune donnée personnelle, seulement réglages, mots-clés et gabarits.
    expect(listApplications(db, at("2026-10-28"))).toEqual([]);
    expect(listKeywords(db).length).toBeGreaterThan(40);
    expect(listTemplates(db).length).toBeGreaterThan(0);
  });
});
