import { asc, eq, isNull, sql } from "drizzle-orm";
import type { Conn } from "@/db";
import { applications, keywords } from "@/db/schema";
import { matchKeywords, type MatchKeyword, type MatchResult } from "@/lib/domain/matching";

export type KeywordInput = { label: string; category: string | null; aliases: string[]; mine: boolean };

export function listKeywords(conn: Conn) {
  return conn.select().from(keywords).orderBy(asc(keywords.category), asc(keywords.label)).all();
}

function matchList(conn: Conn): MatchKeyword[] {
  return listKeywords(conn).map((k) => ({ id: k.id, label: k.label, aliases: k.aliases, mine: k.mine }));
}

export function analyzeOffer(conn: Conn, text: string | null | undefined): MatchResult | null {
  return text?.trim() ? matchKeywords(text, matchList(conn)) : null;
}

export function scoreOffer(conn: Conn, text: string | null | undefined): number | null {
  return analyzeOffer(conn, text)?.score ?? null;
}

/** Après une modification de la liste (ou de « je maîtrise »), tous les scores sont recalculés. */
export function recomputeMatchScores(conn: Conn): void {
  const list = matchList(conn);
  for (const app of conn
    .select({ id: applications.id, offerText: applications.offerText })
    .from(applications)
    .where(isNull(applications.deletedAt))
    .all()) {
    const score = app.offerText?.trim() ? matchKeywords(app.offerText, list).score : null;
    conn.update(applications).set({ matchScore: score }).where(eq(applications.id, app.id)).run();
  }
}

function cleanAliases(aliases: string[]): string[] {
  return [...new Set(aliases.map((a) => a.trim()).filter(Boolean))];
}

export function createKeyword(conn: Conn, input: KeywordInput): number {
  return conn.transaction((tx) => {
    const label = input.label.trim();
    const exists = tx.select().from(keywords).where(sql`lower(${keywords.label}) = lower(${label})`).get();
    if (exists) throw new Error(`« ${exists.label} » est déjà dans la liste`);
    const { id } = tx
      .insert(keywords)
      .values({ label, category: input.category?.trim() || null, aliases: cleanAliases(input.aliases), mine: input.mine })
      .returning({ id: keywords.id })
      .get();
    recomputeMatchScores(tx);
    return id;
  });
}

export function updateKeyword(conn: Conn, id: number, patch: Partial<KeywordInput>): void {
  conn.transaction((tx) => {
    tx.update(keywords)
      .set({
        ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
        ...(patch.category !== undefined ? { category: patch.category?.trim() || null } : {}),
        ...(patch.aliases !== undefined ? { aliases: cleanAliases(patch.aliases) } : {}),
        ...(patch.mine !== undefined ? { mine: patch.mine } : {}),
      })
      .where(eq(keywords.id, id))
      .run();
    recomputeMatchScores(tx);
  });
}

export function deleteKeyword(conn: Conn, id: number): void {
  conn.transaction((tx) => {
    tx.delete(keywords).where(eq(keywords.id, id)).run();
    recomputeMatchScores(tx);
  });
}
