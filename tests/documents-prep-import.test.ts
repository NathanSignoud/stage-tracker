import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { flashcardOrder } from "@/lib/domain/prep";
import { htmlToText, parseOfferHtml, robotsAllows } from "@/lib/domain/offer-parsing";
import { letterToDocx, letterToPdf } from "@/lib/letter-export";
import { createApplication } from "@/server/services/applications";
import { guessDocumentKind, importBaseFolder } from "@/server/services/base-import";
import { getBaseDocument, listApplicationLetters, saveLetterVersion } from "@/server/services/documents";
import { addDefaultPrepQuestions, addPrepQuestion, getPrep, reviewPrepQuestion, saveCompanyNotes } from "@/server/services/prep";
import { extractDocumentText } from "@/server/services/text-extraction";
import { appInput, at, testDb } from "./helpers";

const LETTER = "Madame, Monsieur,\n\nÉtudiant·e en IA, je candidate… « NLP » — œuvre 100 € ✓\nDeuxième ligne.\n\nCordialement,\nAlex";

describe("export des lettres", () => {
  it("DOCX relisible (aller-retour par l'extraction de texte)", async () => {
    const docx = await letterToDocx(LETTER);
    const text = await extractDocumentText("lettre.docx", new Uint8Array(docx));
    expect(text).toContain("Étudiant·e en IA, je candidate… « NLP » — œuvre 100 €");
    expect(text).toContain("Cordialement");
  });

  it("PDF valide, caractères hors police remplacés", async () => {
    const pdf = await letterToPdf(LETTER.repeat(12));
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    const text = await extractDocumentText("lettre.pdf", pdf);
    // « … », « — », « œ », « € » existent dans la police standard ; « ✓ » non → remplacé.
    expect(text).toContain("je candidate… « NLP » — œuvre 100 € ?");
  });
});

describe("documents de base et versions de lettres", () => {
  it("devine le type d'après le nom du fichier", () => {
    expect(guessDocumentKind("CV_Alex_2026.pdf")).toBe("cv");
    expect(guessDocumentKind("lettre-motivation.docx")).toBe("letter");
    expect(guessDocumentKind("LM.md")).toBe("letter");
    expect(guessDocumentKind("photo.pdf")).toBeNull();
    expect(guessDocumentKind("mon-cvtheque.pdf")).toBeNull();
  });

  it("importe data/base une seule fois et désigne les versions de base", async () => {
    const db = testDb();
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "st-base-"));
    const docs = fs.mkdtempSync(path.join(os.tmpdir(), "st-docs-"));
    fs.writeFileSync(path.join(base, "lettre.md"), "Ma lettre de base");
    fs.writeFileSync(path.join(base, "CV.docx"), await letterToDocx("Alex — CV\n\nPython, PyTorch"));
    fs.writeFileSync(path.join(base, "notes.txt"), "?");
    fs.writeFileSync(path.join(base, "LISEZMOI.txt"), "ignoré");

    const report = await importBaseFolder(db, base, docs, at("2026-11-03"));
    expect(report.imported.map((i) => [i.name, i.kind, i.isBase])).toEqual([
      ["CV.docx", "cv", true],
      ["lettre.md", "letter", true],
    ]);
    expect(report.skipped.map((s) => s.name)).toEqual(["notes.txt"]);
    expect(getBaseDocument(db, "letter")?.content).toBe("Ma lettre de base");
    expect(getBaseDocument(db, "cv")?.content).toContain("Python, PyTorch");

    const again = await importBaseFolder(db, base, docs);
    expect(again.imported).toEqual([]);
    expect(again.skipped.filter((s) => s.reason === "déjà importé")).toHaveLength(2);
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(docs, { recursive: true, force: true });
  });

  it("versions numérotées par candidature", () => {
    const db = testDb();
    const app = createApplication(db, appInput({ company: "Owkin" }));
    saveLetterVersion(db, app, "Version 1", at("2026-11-01"));
    saveLetterVersion(db, app, "Version 2", at("2026-11-02"));
    expect(listApplicationLetters(db, app).map((l) => [l.label, l.content])).toEqual([
      ["Lettre — Owkin — v2", "Version 2"],
      ["Lettre — Owkin — v1", "Version 1"],
    ]);
    expect(() => saveLetterVersion(db, app, "   ")).toThrow(/vide/);
  });
});

describe("préparation d'entretien", () => {
  it("notes, questions classiques sans doublon, révision", () => {
    const db = testDb();
    const app = createApplication(db, appInput());
    saveCompanyNotes(db, app, "Fondée en 2023");
    addPrepQuestion(db, app, { kind: "answer", question: "Présentez-vous en deux minutes." });
    const added = addDefaultPrepQuestions(db, app);
    expect(added).toBe(15);
    expect(addDefaultPrepQuestions(db, app)).toBe(0);

    const { notes, questions } = getPrep(db, app);
    expect(notes).toBe("Fondée en 2023");
    const [first, second] = questions;
    reviewPrepQuestion(db, first.id, 2, at("2026-11-03"));
    reviewPrepQuestion(db, second.id, 0, at("2026-11-03"));
    const order = flashcardOrder(getPrep(db, app).questions);
    expect(order[0].id).not.toBe(first.id);
    expect(order.at(-1)!.id).toBe(first.id);
    expect(order.every((q) => q.kind === "answer")).toBe(true);
  });
});

describe("import d'offre", () => {
  it("lit les données structurées JobPosting", () => {
    const html = `<html><head><title>Offre</title>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "Organization", name: "Ignoré" },
          {
            "@type": "JobPosting",
            title: "Stage — Machine Learning Engineer",
            hiringOrganization: { "@type": "Organization", name: "Photoroom" },
            jobLocation: [{ address: { addressLocality: "Paris" } }, { address: { addressLocality: "Paris" } }],
            validThrough: "2026-11-30T23:59:00+01:00",
            description: "&lt;p&gt;Tu rejoindras l&amp;#39;équipe ML.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;PyTorch&lt;/li&gt;&lt;/ul&gt;",
          },
        ],
      })}</script></head><body>…</body></html>`;
    expect(parseOfferHtml(html)).toEqual({
      title: "Stage — Machine Learning Engineer",
      company: "Photoroom",
      location: "Paris",
      remote: null,
      offerText: "Tu rejoindras l'équipe ML.\nPyTorch",
      deadline: "2026-11-30",
      method: "json-ld",
    });
  });

  it("à défaut, lit le contenu principal de la page", () => {
    const html = `<html><head><title>Data Scientist – Stage</title><meta property="og:site_name" content="Doctolib"></head>
      <body><nav>Menu</nav><main><h1>Data Scientist – Stage</h1><p>Missions :</p><ul><li>Modèles NLP</li></ul></main><footer>©</footer></body></html>`;
    const offer = parseOfferHtml(html);
    expect(offer).toMatchObject({ title: "Data Scientist – Stage", company: "Doctolib", method: "html" });
    expect(offer.offerText).toBe("Data Scientist – Stage\nMissions :\nModèles NLP");
    expect(htmlToText("<p>a<br>b</p><script>x()</script>")).toBe("a\nb");
  });

  it("respecte robots.txt", () => {
    const robots = `User-agent: *\nDisallow: /jobs/\nAllow: /jobs/public/\n\nUser-agent: GPTBot\nDisallow: /`;
    expect(robotsAllows(robots, "/careers/123")).toBe(true);
    expect(robotsAllows(robots, "/jobs/123")).toBe(false);
    expect(robotsAllows(robots, "/jobs/public/123")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /*.pdf$", "/offre.pdf")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /*.pdf$", "/offre.pdf?x")).toBe(true);
    expect(robotsAllows("User-agent: StageTracker\nDisallow: /\n\nUser-agent: *\nAllow: /", "/x")).toBe(false);
    expect(robotsAllows("", "/x")).toBe(true);
  });
});
