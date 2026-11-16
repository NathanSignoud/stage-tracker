import { eq, isNull } from "drizzle-orm";
import type { Conn } from "@/db";
import { applications, companies, contacts, interactions } from "@/db/schema";
import { normalizeText } from "@/lib/text";

export type SearchResults = {
  applications: { id: number; company: string; title: string; status: string }[];
  companies: { id: number; name: string; detail: string }[];
  contacts: { id: number; name: string; detail: string }[];
  interactions: { id: number; applicationId: number | null; contactId: number | null; summary: string; detail: string; date: string }[];
};

/**
 * Recherche globale (Ctrl+K), insensible à la casse et aux accents ; tous les mots doivent
 * apparaître. Volume de données modeste : le filtrage se fait en mémoire.
 */
export function search(conn: Conn, query: string, limit = 8): SearchResults {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  const empty: SearchResults = { applications: [], companies: [], contacts: [], interactions: [] };
  if (!terms.length) return empty;
  const matches = (...fields: (string | null | undefined)[]) => {
    const haystack = normalizeText(fields.filter(Boolean).join(" "));
    return terms.every((t) => haystack.includes(t));
  };

  const apps = conn
    .select()
    .from(applications)
    .where(isNull(applications.deletedAt))
    .all()
    .filter((a) => matches(a.company, a.title, a.location, a.notes, a.offerText))
    .slice(0, limit)
    .map((a) => ({ id: a.id, company: a.company, title: a.title, status: a.status }));

  const targets = conn
    .select()
    .from(companies)
    .where(isNull(companies.deletedAt))
    .all()
    .filter((c) => matches(c.name, c.location, c.sector, c.notes))
    .slice(0, limit)
    .map((c) => ({ id: c.id, name: c.name, detail: [c.sector, c.location].filter(Boolean).join(" · ") }));

  const people = conn
    .select()
    .from(contacts)
    .where(isNull(contacts.deletedAt))
    .all()
    .filter((c) => matches(c.name, c.role, c.company, c.email, c.howWeMet, c.notes))
    .slice(0, limit)
    .map((c) => ({ id: c.id, name: c.name, detail: [c.role, c.company].filter(Boolean).join(" · ") }));

  const exchanges = conn
    .select({ interaction: interactions, company: applications.company, contactName: contacts.name })
    .from(interactions)
    .leftJoin(applications, eq(applications.id, interactions.applicationId))
    .leftJoin(contacts, eq(contacts.id, interactions.contactId))
    .where(isNull(interactions.deletedAt))
    .all()
    .filter((r) => matches(r.interaction.summary, r.interaction.content, r.company, r.contactName))
    .sort((a, b) => b.interaction.date.localeCompare(a.interaction.date))
    .slice(0, limit)
    .map((r) => ({
      id: r.interaction.id,
      applicationId: r.interaction.applicationId,
      contactId: r.interaction.contactId,
      summary: r.interaction.summary,
      detail: [r.company, r.contactName].filter(Boolean).join(" · "),
      date: r.interaction.date,
    }));

  return { applications: apps, companies: targets, contacts: people, interactions: exchanges };
}
