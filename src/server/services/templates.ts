import { and, asc, eq } from "drizzle-orm";
import type { Conn } from "@/db";
import { interviewPreps, templates } from "@/db/schema";
import { formatDay, localDateTime } from "@/lib/dates";
import { INTERACTION_LABELS, INTERVIEW_KIND_LABELS, type TemplateKind } from "@/lib/domain/constants";
import { DEFAULT_TEMPLATES } from "@/lib/domain/default-templates";
import { missingVariables, renderTemplate, type TemplateVars } from "@/lib/domain/templates";
import { getApplicationDetail, NotFoundError } from "./applications";
import { knownCompanyNames } from "./companies";
import { getBaseDocument } from "./documents";
import { analyzeOffer, listKeywords } from "./keywords";
import { getSettings } from "./settings";

export function listTemplates(conn: Conn, kind?: TemplateKind) {
  const rows = conn.select().from(templates).orderBy(asc(templates.id)).all();
  return kind ? rows.filter((t) => t.kind === kind) : rows;
}

/** Insère les gabarits par défaut manquants (sans toucher à ceux déjà personnalisés). */
export function ensureDefaultTemplates(conn: Conn, now = new Date()): number {
  let added = 0;
  for (const t of DEFAULT_TEMPLATES) {
    const res = conn
      .insert(templates)
      .values({ ...t, subject: t.subject ?? null, updatedAt: now.toISOString() })
      .onConflictDoNothing()
      .run();
    added += res.changes;
  }
  return added;
}

export function updateTemplate(
  conn: Conn,
  id: number,
  input: { name: string; subject: string | null; body: string },
  now = new Date(),
): void {
  conn
    .update(templates)
    .set({ name: input.name.trim(), subject: input.subject?.trim() || null, body: input.body, updatedAt: now.toISOString() })
    .where(eq(templates.id, id))
    .run();
}

/** Revient au texte livré avec l'app. */
export function resetTemplate(conn: Conn, id: number, now = new Date()): void {
  const current = conn.select().from(templates).where(eq(templates.id, id)).get();
  const original = DEFAULT_TEMPLATES.find((t) => t.kind === current?.kind && t.key === current?.key);
  if (!current || !original) throw new NotFoundError("Gabarit introuvable");
  updateTemplate(conn, id, { name: original.name, subject: original.subject ?? null, body: original.body }, now);
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Profil (Réglages + compétences cochées) tel que transmis à Claude dans {profil}. */
function profileText(conn: Conn): string {
  const { profile } = getSettings(conn);
  const myKeywords = listKeywords(conn).filter((k) => k.mine).map((k) => k.label);
  return [
    profile.summary,
    profile.domains && `Domaines visés : ${profile.domains}`,
    profile.skills && `Compétences clés : ${profile.skills}`,
    myKeywords.length > 0 && `Compétences techniques : ${myKeywords.join(", ")}`,
    profile.startDate && `Début de stage souhaité : ${profile.startDate}`,
    profile.location && `Localisation souhaitée : ${profile.location}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Valeurs des {variables} pour une candidature. `preferUpcoming` : la préparation d'entretien vise
 * le prochain entretien, le remerciement et la relance le dernier entretien passé.
 */
export function buildTemplateVars(
  conn: Conn,
  applicationId: number,
  options: { preferUpcoming?: boolean; now?: Date } = {},
): TemplateVars {
  const detail = getApplicationDetail(conn, applicationId);
  if (!detail || detail.application.deletedAt) throw new NotFoundError("Candidature introuvable");
  const app = detail.application;
  const { profile } = getSettings(conn);
  const now = localDateTime(options.now);

  const contact =
    detail.contacts.find((c) => /recrut|rh|talent|manager/i.test(`${c.relation ?? ""} ${c.role ?? ""}`)) ?? detail.contacts[0];
  const interviews = detail.interactions.filter((i) => i.type === "interview").sort((a, b) => a.date.localeCompare(b.date));
  const past = interviews.filter((i) => i.date <= now);
  const upcoming = interviews.filter((i) => i.date > now);
  const interview = options.preferUpcoming ? (upcoming[0] ?? past.at(-1)) : (past.at(-1) ?? upcoming[0]);

  const analysis = analyzeOffer(conn, app.offerText);
  const labels = (hits: { keyword: { label: string } }[]) => hits.map((h) => h.keyword.label).join(", ") || "aucune";
  const prep = conn.select().from(interviewPreps).where(eq(interviewPreps.applicationId, app.id)).get();
  const profil = profileText(conn);

  // Toutes les notes utiles : candidature, chaque entretien (passé ou prévu), fiche de préparation.
  const notes = [
    app.notes && `Notes sur la candidature :\n${app.notes}`,
    ...interviews
      .filter((i) => i.content)
      .map((i) => `Notes — ${lowerFirst(INTERVIEW_KIND_LABELS[i.interviewKind ?? "other"])} du ${formatDay(i.date, "d MMMM")} :\n${i.content}`),
    prep?.companyNotes && `Notes sur l'entreprise :\n${prep.companyNotes}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const historique = detail.interactions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12)
    .map((i) => {
      const label = i.type === "interview" ? INTERVIEW_KIND_LABELS[i.interviewKind ?? "other"] : INTERACTION_LABELS[i.type];
      return `- ${formatDay(i.date, "d MMM yyyy")} · ${label} : ${i.summary}`;
    })
    .join("\n");

  return {
    entreprise: app.company,
    poste: app.title,
    contact: contact?.name,
    contact_prenom: contact?.name.split(/\s+/)[0],
    date_envoi: app.sentDate && formatDay(app.sentDate, "d MMMM yyyy"),
    date_entretien: interview && formatDay(interview.date, "EEEE d MMMM"),
    type_entretien: interview && lowerFirst(INTERVIEW_KIND_LABELS[interview.interviewKind ?? "other"]),
    lieu: app.location,
    texte_offre: app.offerText,
    mots_cles_trouves: analysis && labels(analysis.mine),
    mots_cles_manquants: analysis && labels(analysis.missing),
    score: analysis?.score != null ? `${Math.round(analysis.score * 100)} %` : null,
    lettre_base: getBaseDocument(conn, "letter")?.content,
    cv_base: getBaseDocument(conn, "cv")?.content,
    profil,
    notes,
    historique,
    mon_nom: profile.fullName,
    mon_email: profile.email,
    mon_telephone: profile.phone,
  };
}

export type RenderedTemplate = {
  id: number;
  key: string;
  name: string;
  subject: string | null;
  body: string;
  /** Variables utilisées mais vides : à compléter avant d'envoyer. */
  missing: string[];
};

export function renderForApplication(
  conn: Conn,
  kind: TemplateKind,
  key: string,
  applicationId: number,
  now = new Date(),
): RenderedTemplate {
  const template = conn.select().from(templates).where(and(eq(templates.kind, kind), eq(templates.key, key))).get();
  if (!template) throw new NotFoundError("Gabarit introuvable");
  const vars = buildTemplateVars(conn, applicationId, { preferUpcoming: key === "interview_prep", now });
  return {
    id: template.id,
    key: template.key,
    name: template.name,
    subject: template.subject ? renderTemplate(template.subject, vars) : null,
    body: renderTemplate(template.body, vars),
    missing: missingVariables(`${template.subject ?? ""}\n${template.body}`, vars),
  };
}

/** Prompt indépendant d'une candidature (ex. recherche d'entreprises) : profil + entreprises déjà connues. */
export function renderGlobalPrompt(conn: Conn, key: string): RenderedTemplate {
  const template = conn.select().from(templates).where(and(eq(templates.kind, "prompt"), eq(templates.key, key))).get();
  if (!template) throw new NotFoundError("Gabarit introuvable");
  const { profile } = getSettings(conn);
  const vars: TemplateVars = {
    profil: profileText(conn),
    mon_nom: profile.fullName,
    entreprises_connues: knownCompanyNames(conn).join(", ") || "aucune pour l'instant",
  };
  return {
    id: template.id,
    key: template.key,
    name: template.name,
    subject: null,
    body: renderTemplate(template.body, vars),
    missing: missingVariables(template.body, vars),
  };
}
