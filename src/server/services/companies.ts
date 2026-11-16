import { asc, eq, isNull } from "drizzle-orm";
import type { Conn } from "@/db";
import { applications, companies, contacts } from "@/db/schema";
import type { CompanyStatus, Status } from "@/lib/domain/constants";
import { companyKey, type CompanyRow } from "@/lib/domain/company-import";
import { createApplication, NotFoundError } from "./applications";

export type CompanyInput = CompanyRow & { status?: CompanyStatus };

function liveCompanies(conn: Conn) {
  return conn.select().from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.name)).all();
}

/** Entreprises de la liste, avec les candidatures et contacts rapprochés par nom. */
export function listCompanies(conn: Conn) {
  const apps = conn
    .select({ id: applications.id, company: applications.company, status: applications.status })
    .from(applications)
    .where(isNull(applications.deletedAt))
    .all();
  const people = conn.select({ company: contacts.company }).from(contacts).where(isNull(contacts.deletedAt)).all();
  return liveCompanies(conn).map((c) => {
    const key = companyKey(c.name);
    return {
      ...c,
      applications: apps.filter((a) => companyKey(a.company) === key).map((a) => ({ id: a.id, status: a.status as Status })),
      contactCount: people.filter((p) => p.company && companyKey(p.company) === key).length,
    };
  });
}

export type CompanyListItem = ReturnType<typeof listCompanies>[number];

/** Noms déjà connus (liste + candidatures) : à exclure d'une nouvelle recherche avec Claude. */
export function knownCompanyNames(conn: Conn): string[] {
  const names = [
    ...liveCompanies(conn).map((c) => c.name),
    ...conn.select({ name: applications.company }).from(applications).where(isNull(applications.deletedAt)).all().map((a) => a.name),
  ];
  const byKey = new Map<string, string>();
  for (const n of names) if (!byKey.has(companyKey(n))) byKey.set(companyKey(n), n);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

export type CompanyImportReport = { created: number; completed: number; unchanged: number; applicationsCreated: number };

/**
 * Importe une liste : les entreprises déjà présentes (même nom) ne sont pas dupliquées, seuls leurs
 * champs vides sont complétés. Option : une candidature « À explorer » par entreprise sans candidature.
 */
export function importCompanies(
  conn: Conn,
  rows: CompanyRow[],
  options: { createApplications?: boolean } = {},
  now = new Date(),
): CompanyImportReport {
  return conn.transaction((tx) => {
    const report: CompanyImportReport = { created: 0, completed: 0, unchanged: 0, applicationsCreated: 0 };
    const existing = new Map(liveCompanies(tx).map((c) => [companyKey(c.name), c]));
    const appKeys = new Set(
      tx.select({ company: applications.company }).from(applications).where(isNull(applications.deletedAt)).all().map((a) => companyKey(a.company)),
    );
    const nowIso = now.toISOString();

    for (const row of rows) {
      const key = companyKey(row.name);
      if (!key) continue;
      const found = existing.get(key);
      if (found) {
        const patch = Object.fromEntries(
          (["careersUrl", "location", "sector", "notes"] as const).filter((f) => !found[f] && row[f]).map((f) => [f, row[f]]),
        );
        if (Object.keys(patch).length) {
          tx.update(companies).set({ ...patch, updatedAt: nowIso }).where(eq(companies.id, found.id)).run();
          report.completed++;
        } else report.unchanged++;
      } else {
        const created = tx
          .insert(companies)
          .values({ ...row, name: row.name.trim(), createdAt: nowIso, updatedAt: nowIso })
          .returning()
          .get();
        existing.set(key, created);
        report.created++;
      }
      if (options.createApplications && !appKeys.has(key)) {
        const company = existing.get(key)!;
        createApplicationFromCompanyRow(tx, company, now);
        appKeys.add(key);
        report.applicationsCreated++;
      }
    }
    return report;
  });
}

function createApplicationFromCompanyRow(conn: Conn, c: typeof companies.$inferSelect, now: Date): number {
  return createApplication(
    conn,
    {
      company: c.name,
      title: "",
      // Pas encore d'offre précise : le lien pointe vers la page carrière.
      offerUrl: c.careersUrl,
      offerText: null,
      source: "career_site",
      location: c.location,
      remote: null,
      duration: null,
      startDate: null,
      stipend: null,
      deadline: null,
      sentDate: null,
      priority: c.status === "interesting" ? 1 : 2,
      notes: c.notes,
      status: "to_explore",
    },
    now,
  );
}

/** « Candidater » depuis la liste : candidature « À explorer » pré-remplie (page carrière, lieu, notes). */
export function createApplicationFromCompany(conn: Conn, id: number, now = new Date()): number {
  const company = conn.select().from(companies).where(eq(companies.id, id)).get();
  if (!company || company.deletedAt) throw new NotFoundError("Entreprise introuvable");
  return createApplicationFromCompanyRow(conn, company, now);
}

export function createCompany(conn: Conn, input: CompanyInput, now = new Date()): number {
  const key = companyKey(input.name);
  const duplicate = liveCompanies(conn).find((c) => companyKey(c.name) === key);
  if (duplicate) throw new Error(`« ${duplicate.name} » est déjà dans ta liste`);
  const nowIso = now.toISOString();
  return conn
    .insert(companies)
    .values({ ...input, name: input.name.trim(), createdAt: nowIso, updatedAt: nowIso })
    .returning({ id: companies.id })
    .get().id;
}

export function updateCompany(conn: Conn, id: number, input: Partial<CompanyInput>, now = new Date()): void {
  conn
    .update(companies)
    .set({ ...input, ...(input.name ? { name: input.name.trim() } : {}), updatedAt: now.toISOString() })
    .where(eq(companies.id, id))
    .run();
}
