import { describe, expect, it } from "vitest";
import { mailtoUrl, missingVariables, renderTemplate } from "@/lib/domain/templates";
import { changeStatus, createApplication } from "@/server/services/applications";
import { createContact, linkContact } from "@/server/services/contacts";
import { createDocument, setBaseDocument } from "@/server/services/documents";
import { createInteraction } from "@/server/services/interactions";
import { createKeyword } from "@/server/services/keywords";
import { seedIfNeeded } from "@/server/seed";
import { updateSettings } from "@/server/services/settings";
import { listTemplates, renderForApplication, resetTemplate, updateTemplate } from "@/server/services/templates";
import { appInput, at, testDb } from "./helpers";

describe("rendu des variables", () => {
  it("remplace, signale les vides, laisse les accolades inconnues", () => {
    const vars = { entreprise: "Mistral", contact: "", poste: null };
    expect(renderTemplate("Bonjour {contact}, chez {entreprise} ({poste}) {inconnue}", vars)).toBe(
      "Bonjour [contact], chez Mistral ([poste]) {inconnue}",
    );
    expect(missingVariables("{entreprise} {contact} {poste} {contact}", vars)).toEqual(["contact", "poste"]);
  });

  it("construit un lien mailto encodé", () => {
    expect(mailtoUrl({ to: "a@b.fr", subject: "Stage — NLP", body: "Bonjour,\nMerci & à bientôt" })).toBe(
      "mailto:a%40b.fr?subject=Stage%20%E2%80%94%20NLP&body=Bonjour%2C%0AMerci%20%26%20%C3%A0%20bient%C3%B4t",
    );
  });
});

describe("gabarits appliqués à une candidature", () => {
  function setup() {
    const db = testDb();
    seedIfNeeded(db, at("2026-10-28"));
    updateSettings(db, {
      profile: { fullName: "Alex Martin", email: "alex@example.com", phone: "06 00 00 00 00", linkedin: "", summary: "Élève ingénieur IA", startDate: "février 2027", domains: "NLP", skills: "PyTorch", location: "Paris" },
    });
    createKeyword(db, { label: "Kotlin", category: null, aliases: [], mine: false });
    const app = createApplication(db, appInput({ company: "Hugging Face", title: "Stage NLP", offerText: "Python, Kotlin et NLP." }), at("2026-10-01"));
    changeStatus(db, app, "sent", at("2026-10-02"));
    const contact = createContact(db, { name: "Camille Durand", role: "Talent Acquisition", company: "Hugging Face", email: "camille@hf.co", phone: null, linkedin: null, howWeMet: null, notes: null });
    linkContact(db, app, contact, "Recruteuse");
    createInteraction(db, { applicationId: app, contactId: contact, date: "2026-10-20T10:00", type: "interview", interviewKind: "hr", summary: "Entretien RH", content: "Équipe de 6, projet RAG", location: null, nextAction: null, nextActionDate: null }, at("2026-10-15"));
    createInteraction(db, { applicationId: app, contactId: contact, date: "2026-11-05T14:00", type: "interview", interviewKind: "tech", summary: "Entretien technique", content: null, location: null, nextAction: null, nextActionDate: null }, at("2026-10-21"));
    const letter = createDocument(db, { kind: "letter", label: "Lettre de base", content: "Madame, Monsieur, …" }, null);
    setBaseDocument(db, letter);
    return { db, app };
  }

  it("10 gabarits livrés (6 prompts, 4 messages)", () => {
    const { db } = setup();
    expect(listTemplates(db, "prompt")).toHaveLength(6);
    expect(listTemplates(db, "message")).toHaveLength(4);
  });

  it("message de remerciement : dernier entretien passé, contact, signature", () => {
    const { db, app } = setup();
    const msg = renderForApplication(db, "message", "thank_you", app, at("2026-10-28"));
    expect(msg.subject).toBe("Merci pour notre échange — Stage NLP");
    expect(msg.body).toContain("Bonjour Camille,");
    expect(msg.body).toContain("notre entretien RH du mardi 20 octobre");
    expect(msg.body).toContain("Alex Martin");
    expect(msg.missing).toEqual([]);
  });

  it("prompt de préparation : prochain entretien, compétences, lettre et CV", () => {
    const { db, app } = setup();
    const prompt = renderForApplication(db, "prompt", "interview_prep", app, at("2026-10-28"));
    expect(prompt.body).toContain("mon entretien technique avec Hugging Face");
    expect(prompt.body).toContain("(prévu le jeudi 5 novembre)");
    // Python et NLP viennent des mots-clés de départ, pas encore cochés « maîtrisés ».
    expect(prompt.body).toContain("(Kotlin, Python, NLP)");
    expect(prompt.body).toContain("Notes — entretien RH du 20 octobre :\nÉquipe de 6, projet RAG");
    expect(prompt.missing).toEqual(["cv_base"]);

    const letterPrompt = renderForApplication(db, "prompt", "letter", app, at("2026-10-28"));
    expect(letterPrompt.body).toContain("Madame, Monsieur, …");
    expect(letterPrompt.body).toContain("Élève ingénieur IA");
  });

  it("modification puis réinitialisation d'un gabarit", () => {
    const { db, app } = setup();
    const tpl = listTemplates(db, "message").find((t) => t.key === "follow_up")!;
    updateTemplate(db, tpl.id, { name: "Relance perso", subject: "Re : {poste}", body: "Coucou {entreprise}" });
    expect(renderForApplication(db, "message", "follow_up", app).body).toBe("Coucou Hugging Face");
    resetTemplate(db, tpl.id);
    expect(renderForApplication(db, "message", "follow_up", app).body).toContain("Je me permets de revenir vers vous");
  });
});
