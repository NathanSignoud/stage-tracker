"use server";

import { z } from "zod";
import { getDb } from "@/db";
import { STATUSES } from "@/lib/domain/constants";
import { applicationInputSchema, contactInputSchema, quickAddSchema } from "@/lib/validation";
import {
  changeStatus,
  createApplication,
  getApplicationDetail,
  markFollowedUp,
  updateApplication,
} from "@/server/services/applications";
import { interviewsToSchedule } from "@/server/services/calendar";
import { createContact, linkContact, listContacts, requireContact, unlinkContact } from "@/server/services/contacts";
import { mutate } from "./result";

const id = z.coerce.number().int().positive();
const relation = z.string().trim().nullish().transform((v) => v || null);

export async function quickAddApplicationAction(input: unknown) {
  return mutate(() => createApplication(getDb(), quickAddSchema.parse(input)));
}

const newApplicationSchema = applicationInputSchema.extend({ status: z.enum(STATUSES).default("to_explore") });

export async function createApplicationAction(input: unknown) {
  return mutate(() => createApplication(getDb(), newApplicationSchema.parse(input)));
}

export async function updateApplicationAction(applicationId: number, input: unknown) {
  return mutate(() => updateApplication(getDb(), id.parse(applicationId), applicationInputSchema.parse(input)));
}

/**
 * Change le statut. Renvoie le type d'entretien à planifier si la candidature arrive en
 * « Entretien RH / technique » sans entretien daté : l'interface demande alors la date.
 */
export async function changeStatusAction(applicationId: number, status: string) {
  return mutate(() => {
    const db = getDb();
    const appId = id.parse(applicationId);
    changeStatus(db, appId, z.enum(STATUSES).parse(status));
    const pending = interviewsToSchedule(db).find((a) => a.id === appId);
    return { scheduleKind: pending?.kind ?? null };
  });
}

/** Contacts proposés dans le dialogue « Planifier un entretien » (liés à la candidature d'abord). */
export async function interviewContactsAction(applicationId: number) {
  const db = getDb();
  const detail = getApplicationDetail(db, id.parse(applicationId));
  const linked = detail?.contacts ?? [];
  return [
    ...linked.map((c) => ({ id: c.id, name: c.name, detail: c.relation ?? c.role })),
    ...listContacts(db)
      .filter((c) => !linked.some((l) => l.id === c.id))
      .map((c) => ({ id: c.id, name: c.name, detail: c.company })),
  ];
}

export async function markFollowedUpAction(applicationId: number) {
  return mutate(() => markFollowedUp(getDb(), id.parse(applicationId)));
}

export async function linkContactAction(applicationId: number, contactId: number, rel?: string | null) {
  return mutate(() => {
    const db = getDb();
    requireContact(db, id.parse(contactId));
    linkContact(db, id.parse(applicationId), contactId, relation.parse(rel));
  });
}

export async function createAndLinkContactAction(applicationId: number, input: unknown, rel?: string | null) {
  return mutate(() => {
    const db = getDb();
    return db.transaction((tx) => {
      const contactId = createContact(tx, contactInputSchema.parse(input));
      linkContact(tx, id.parse(applicationId), contactId, relation.parse(rel));
      return contactId;
    });
  });
}

export async function unlinkContactAction(applicationId: number, contactId: number) {
  return mutate(() => unlinkContact(getDb(), id.parse(applicationId), id.parse(contactId)));
}
