import { describe, expect, it } from "vitest";
import { cleanUrl, companyKey, parseCompanyList } from "@/lib/domain/company-import";
import { createApplication, listApplications } from "@/server/services/applications";
import { createApplicationFromCompany, createCompany, importCompanies, knownCompanyNames, listCompanies } from "@/server/services/companies";
import { createContact } from "@/server/services/contacts";
import { renderGlobalPrompt } from "@/server/services/templates";
import { seedIfNeeded } from "@/server/seed";
import { appInput, at, testDb } from "./helpers";

describe("lecture d'une liste d'entreprises", () => {
  it("tableau Markdown de Claude (gras, liens, colonnes en français)", () => {
    const text = `Voici une sélection :

| Entreprise | Site carrière | Localisation | Secteur | Pourquoi |
|---|---|---|---|---|
| **Mistral AI** | [Carrières](https://mistral.ai/careers) | Paris | IA générative | LLM open source |
| Hugging Face | https://apply.workable.com/huggingface/ | Paris / Remote | NLP | — |
| Owkin | owkin.com/careers | Paris, Nantes | Santé | IA médicale |`;
    const parsed = parseCompanyList(text);
    expect(parsed.format).toBe("markdown");
    expect(parsed.columns).toEqual({ name: "Entreprise", careersUrl: "Site carrière", location: "Localisation", sector: "Secteur", notes: "Pourquoi" });
    expect(parsed.rows).toEqual([
      { name: "Mistral AI", careersUrl: "https://mistral.ai/careers", location: "Paris", sector: "IA générative", notes: "LLM open source" },
      { name: "Hugging Face", careersUrl: "https://apply.workable.com/huggingface/", location: "Paris / Remote", sector: "NLP", notes: null },
      { name: "Owkin", careersUrl: "https://owkin.com/careers", location: "Paris, Nantes", sector: "Santé", notes: "IA médicale" },
    ]);
  });

  it("CSV au point-virgule (format du prompt), guillemets et retours à la ligne", () => {
    const text = `\`\`\`csv
entreprise;site_carriere;localisation;secteur;notes
Photoroom;https://jobs.photoroom.com;Paris;Vision;"Édition photo; IA générative"
"Doctolib";https://careers.doctolib.com;"Paris";Santé;"Équipe data
en croissance"
\`\`\``;
    const parsed = parseCompanyList(text);
    expect(parsed.format).toBe("csv");
    expect(parsed.rows.map((r) => [r.name, r.notes])).toEqual([
      ["Photoroom", "Édition photo; IA générative"],
      ["Doctolib", "Équipe data en croissance"],
    ]);
  });

  it("copie depuis un tableur (TSV), en-têtes anglais, site carrière préféré au site web", () => {
    const text = "Company\tWebsite\tCareers page\tCity\nDataiku\thttps://www.dataiku.com\thttps://www.dataiku.com/careers/\tParis";
    const parsed = parseCompanyList(text);
    expect(parsed.format).toBe("tsv");
    expect(parsed.rows).toEqual([{ name: "Dataiku", careersUrl: "https://www.dataiku.com/careers/", location: "Paris", sector: null, notes: null }]);
  });

  it("JSON (éventuellement entouré de ```json)", () => {
    const text = '```json\n{"entreprises": [{"nom": "Alan", "url": "https://alan.com/careers", "ville": "Paris"}]}\n```';
    expect(parseCompanyList(text)).toMatchObject({
      format: "json",
      rows: [{ name: "Alan", careersUrl: "https://alan.com/careers", location: "Paris" }],
    });
  });

  it("liste à puces", () => {
    const text = `1. **Mistral AI** (Paris) — https://mistral.ai/careers — LLM open source
- Hugging Face — Paris — https://apply.workable.com/huggingface
- Criteo : criteo.com/careers`;
    expect(parseCompanyList(text).rows).toEqual([
      { name: "Mistral AI", careersUrl: "https://mistral.ai/careers", location: "Paris", sector: null, notes: "LLM open source" },
      { name: "Hugging Face", careersUrl: "https://apply.workable.com/huggingface", location: "Paris", sector: null, notes: null },
      { name: "Criteo", careersUrl: "https://criteo.com/careers", location: null, sector: null, notes: null },
    ]);
  });

  it("sans en-tête : la colonne d'URL est reconnue", () => {
    const parsed = parseCompanyList("Mistral AI;https://mistral.ai/careers;Paris\nOwkin;https://owkin.com/careers;Nantes");
    expect(parsed.rows.map((r) => [r.name, r.careersUrl, r.location])).toEqual([
      ["Mistral AI", "https://mistral.ai/careers", "Paris"],
      ["Owkin", "https://owkin.com/careers", "Nantes"],
    ]);
  });

  it("fusionne les doublons et signale les lignes sans nom", () => {
    const parsed = parseCompanyList("entreprise;site_carriere;localisation\nMistral AI;;Paris\nmistral-ai;https://mistral.ai/careers;\n;https://x.com;Lyon");
    expect(parsed.rows).toEqual([{ name: "Mistral AI", careersUrl: "https://mistral.ai/careers", location: "Paris", sector: null, notes: null }]);
    expect(parsed.skipped.map((s) => [s.line, s.reason])).toEqual([
      [3, "doublon de « Mistral AI » (fusionné)"],
      [4, "nom d'entreprise manquant"],
    ]);
  });

  it("normalise noms et URLs", () => {
    expect(companyKey("Hugging-Face")).toBe(companyKey("hugging face"));
    expect(cleanUrl("www.alan.com/careers.")).toBe("https://www.alan.com/careers");
    expect(cleanUrl("[Jobs](https://jobs.lever.co/mistral)")).toBe("https://jobs.lever.co/mistral");
    expect(cleanUrl("pas une url")).toBeNull();
  });
});

describe("liste d'entreprises", () => {
  const row = (name: string, extra: Partial<{ careersUrl: string; location: string; sector: string; notes: string }> = {}) => ({
    name,
    careersUrl: null,
    location: null,
    sector: null,
    notes: null,
    ...extra,
  });

  it("import : pas de doublon, champs vides complétés", () => {
    const db = testDb();
    createCompany(db, { ...row("Mistral AI", { location: "Paris" }), status: "interesting" });
    const report = importCompanies(db, [
      row("mistral ai", { careersUrl: "https://mistral.ai/careers", location: "Lyon" }),
      row("Owkin", { location: "Nantes" }),
      row("Owkin"),
    ]);
    expect(report).toEqual({ created: 1, completed: 1, unchanged: 1, applicationsCreated: 0 });
    const list = listCompanies(db);
    expect(list.map((c) => [c.name, c.careersUrl, c.location, c.status])).toEqual([
      ["Mistral AI", "https://mistral.ai/careers", "Paris", "interesting"],
      ["Owkin", null, "Nantes", "to_explore"],
    ]);
  });

  it("option : une candidature « À explorer » par entreprise sans candidature", () => {
    const db = testDb();
    createApplication(db, appInput({ company: "Hugging Face" }));
    const report = importCompanies(
      db,
      [row("Hugging Face"), row("Photoroom", { careersUrl: "https://jobs.photoroom.com", location: "Paris", notes: "Vision" })],
      { createApplications: true },
      at("2026-11-09"),
    );
    expect(report.applicationsCreated).toBe(1);
    const photoroom = listApplications(db).find((a) => a.company === "Photoroom")!;
    expect(photoroom).toMatchObject({ status: "to_explore", offerUrl: "https://jobs.photoroom.com", location: "Paris", source: "career_site", notes: "Vision" });
  });

  it("candidatures et contacts rapprochés par le nom ; « Candidater » depuis la liste", () => {
    const db = testDb();
    const id = createCompany(db, row("Hugging Face", { careersUrl: "https://hf.co/jobs" }));
    createContact(db, { name: "Camille", role: null, company: "hugging-face", email: null, phone: null, linkedin: null, howWeMet: null, notes: null });
    expect(listCompanies(db)[0]).toMatchObject({ applications: [], contactCount: 1 });
    const appId = createApplicationFromCompany(db, id);
    expect(listCompanies(db)[0].applications).toEqual([{ id: appId, status: "to_explore" }]);
    expect(() => createCompany(db, row("HUGGING FACE"))).toThrow(/déjà dans ta liste/);
  });

  it("prompt de recherche : profil et entreprises déjà connues", () => {
    const db = testDb();
    seedIfNeeded(db, at("2026-11-09"));
    createCompany(db, row("Owkin"));
    const prompt = renderGlobalPrompt(db, "company_research");
    expect(knownCompanyNames(db)).toEqual(["Owkin"]);
    expect(prompt.body).toContain("Exclus les entreprises déjà dans ma liste : Owkin.");
    expect(prompt.body).toContain("entreprise;site_carriere;localisation;secteur;notes");
    expect(prompt.missing).toEqual(["profil"]);
  });
});
