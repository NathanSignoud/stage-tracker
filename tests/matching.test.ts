import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { applications, keywords } from "@/db/schema";
import { foldForMatch, highlightSegments, matchKeywords, type MatchKeyword } from "@/lib/domain/matching";
import { createApplication, setOfferText } from "@/server/services/applications";
import { createKeyword, updateKeyword } from "@/server/services/keywords";
import { appInput, testDb } from "./helpers";

let nextId = 1;
const kw = (label: string, mine = false, aliases: string[] = []): MatchKeyword => ({ id: nextId++, label, aliases, mine });
const found = (text: string, list: MatchKeyword[]) => matchKeywords(text, list).hits.map((h) => h.keyword.label);

describe("détection des compétences", () => {
  it("ignore casse, accents et tirets, conserve la longueur", () => {
    const text = "Expérience en Apprentissage-Profond et vision par ordinateur";
    expect(foldForMatch(text)).toHaveLength(text.length);
    expect(found(text, [kw("Deep Learning", false, ["apprentissage profond"]), kw("Computer Vision", false, ["vision par ordinateur"])])).toEqual([
      "Deep Learning",
      "Computer Vision",
    ]);
  });

  it("respecte les frontières de mots", () => {
    expect(found("Maîtrise de Java et JavaScript", [kw("Java")])).toEqual(["Java"]);
    expect(found("JavaScript uniquement", [kw("Java")])).toEqual([]);
    expect(found("Pythonic code", [kw("Python")])).toEqual([]);
    expect(found("RAG, LLM et fine-tuning", [kw("RAG"), kw("LLM"), kw("Fine-tuning")])).toEqual(["RAG", "LLM", "Fine-tuning"]);
  });

  it("gère C++, C# et les langages à une lettre", () => {
    const list = [kw("C++"), kw("C"), kw("R")];
    expect(found("Langages : Python, R, C++.", list)).toEqual(["C++", "R"]);
    expect(found("Département R&D, c'est un plus", list)).toEqual([]);
    expect(found("Le C++ moderne", [kw("C")])).toEqual([]);
    expect(found("C# et .NET", [kw("C#")])).toEqual(["C#"]);
  });

  it("score = maîtrisées / détectées, null si rien n'est détecté", () => {
    const list = [kw("Python", true), kw("PyTorch", true), kw("Kubernetes"), kw("Rust")];
    const result = matchKeywords("Python, PyTorch et Kubernetes requis", list);
    expect(result.score).toBe(0.67);
    expect(result.missing.map((h) => h.keyword.label)).toEqual(["Kubernetes"]);
    expect(matchKeywords("Aucune compétence ici", list).score).toBeNull();
  });

  it("découpe le texte pour le surlignage", () => {
    const list = [kw("Python", true), kw("SQL")];
    const text = "Python et SQL, Python encore";
    const segments = highlightSegments(text, matchKeywords(text, list).hits);
    expect(segments.map((s) => [s.text, s.hit?.mine ?? null])).toEqual([
      ["Python", true],
      [" et ", null],
      ["SQL", false],
      [", ", null],
      ["Python", true],
      [" encore", null],
    ]);
    expect(segments.map((s) => s.text).join("")).toBe(text);
  });
});

describe("score enregistré sur la candidature", () => {
  it("calculé à l'écriture de l'offre et recalculé quand la liste change", () => {
    const db = testDb();
    createKeyword(db, { label: "Python", category: null, aliases: [], mine: true });
    const docker = createKeyword(db, { label: "Docker", category: null, aliases: [], mine: false });
    const id = createApplication(db, appInput({ offerText: "Python et Docker" }));
    const score = () => db.select().from(applications).where(eq(applications.id, id)).get()!.matchScore;
    expect(score()).toBe(0.5);

    updateKeyword(db, docker, { mine: true });
    expect(score()).toBe(1);

    setOfferText(db, id, "Rien de technique");
    expect(score()).toBeNull();
  });

  it("refuse un doublon (casse ignorée)", () => {
    const db = testDb();
    createKeyword(db, { label: "PyTorch", category: null, aliases: [], mine: false });
    expect(() => createKeyword(db, { label: "pytorch", category: null, aliases: [], mine: false })).toThrow(/déjà/);
    expect(db.select().from(keywords).all()).toHaveLength(1);
  });
});
