import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import type { Conn } from "@/db";
import { applicationContacts, applications, contacts, interactions } from "@/db/schema";
import type { ContactInput } from "@/lib/validation";
import { NotFoundError } from "./applications";

export function createContact(conn: Conn, input: ContactInput, now = new Date()): number {
  const nowIso = now.toISOString();
  return conn
    .insert(contacts)
    .values({ ...input, createdAt: nowIso, updatedAt: nowIso })
    .returning({ id: contacts.id })
    .get().id;
}

export function updateContact(conn: Conn, id: number, input: ContactInput, now = new Date()): void {
  conn
    .update(contacts)
    .set({ ...input, updatedAt: now.toISOString() })
    .where(eq(contacts.id, id))
    .run();
}

export function linkContact(
  conn: Conn,
  applicationId: number,
  contactId: number,
  relation: string | null,
): void {
  conn
    .insert(applicationContacts)
    .values({ applicationId, contactId, relation })
    .onConflictDoUpdate({
      target: [applicationContacts.applicationId, applicationContacts.contactId],
      set: { relation },
    })
    .run();
}

export function unlinkContact(conn: Conn, applicationId: number, contactId: number): void {
  conn
    .delete(applicationContacts)
    .where(
      and(
        eq(applicationContacts.applicationId, applicationId),
        eq(applicationContacts.contactId, contactId),
      ),
    )
    .run();
}

export function listContacts(conn: Conn) {
  const counts = new Map(
    conn
      .select({ contactId: applicationContacts.contactId, n: count() })
      .from(applicationContacts)
      .innerJoin(applications, eq(applications.id, applicationContacts.applicationId))
      .where(isNull(applications.deletedAt))
      .groupBy(applicationContacts.contactId)
      .all()
      .map((r) => [r.contactId, r.n]),
  );
  return conn
    .select()
    .from(contacts)
    .where(isNull(contacts.deletedAt))
    .orderBy(asc(contacts.name))
    .all()
    .map((c) => ({ ...c, applicationCount: counts.get(c.id) ?? 0 }));
}

export type ContactListItem = ReturnType<typeof listContacts>[number];

export function getContactDetail(conn: Conn, id: number) {
  const contact = conn.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!contact) return null;

  const linkedApplications = conn
    .select({
      id: applications.id,
      company: applications.company,
      title: applications.title,
      status: applications.status,
      relation: applicationContacts.relation,
    })
    .from(applicationContacts)
    .innerJoin(applications, eq(applications.id, applicationContacts.applicationId))
    .where(and(eq(applicationContacts.contactId, id), isNull(applications.deletedAt)))
    .orderBy(asc(applications.company))
    .all();

  const contactInteractions = conn
    .select({ interaction: interactions, company: applications.company })
    .from(interactions)
    .leftJoin(applications, eq(applications.id, interactions.applicationId))
    .where(and(eq(interactions.contactId, id), isNull(interactions.deletedAt)))
    .orderBy(desc(interactions.date))
    .all()
    .map((r) => ({ ...r.interaction, company: r.company }));

  return { contact, applications: linkedApplications, interactions: contactInteractions };
}

export function requireContact(conn: Conn, id: number) {
  const contact = conn.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!contact || contact.deletedAt) throw new NotFoundError("Contact introuvable");
  return contact;
}
