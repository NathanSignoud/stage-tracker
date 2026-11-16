import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import type {
  CompanyStatus,
  DocumentKind,
  InteractionType,
  InterviewKind,
  PrepQuestionKind,
  Priority,
  RemoteMode,
  Source,
  Status,
  TaskOrigin,
  TemplateKind,
} from "@/lib/domain/constants";

// Conventions de dates (voir CLAUDE.md) :
// - instants techniques (created_at, deleted_at, changed_at…) : ISO UTC `2026-10-28T17:06:23.459Z`
// - dates saisies par l'utilisateur : `YYYY-MM-DD` ; date + heure d'un échange : `YYYY-MM-DDTHH:mm` (heure locale)
const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);
const updatedAt = () =>
  text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);
const deletedAt = () => text("deleted_at");

export const applications = sqliteTable(
  "applications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    company: text("company").notNull(),
    title: text("title").notNull().default(""),
    offerUrl: text("offer_url"),
    offerText: text("offer_text"),
    source: text("source").$type<Source>(),
    location: text("location"),
    remote: text("remote").$type<RemoteMode>(),
    duration: text("duration"),
    startDate: text("start_date"),
    stipend: text("stipend"),
    deadline: text("deadline"),
    sentDate: text("sent_date"),
    status: text("status").$type<Status>().notNull().default("to_explore"),
    priority: integer("priority").$type<Priority>().notNull().default(2),
    matchScore: real("match_score"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("applications_status_idx").on(t.status)],
);

export const statusChanges = sqliteTable(
  "status_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<Status>(),
    toStatus: text("to_status").$type<Status>().notNull(),
    changedAt: text("changed_at").notNull(),
  },
  (t) => [index("status_changes_application_idx").on(t.applicationId)],
);

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("tags_name_unique").on(t.name)],
);

export const applicationTags = sqliteTable(
  "application_tags",
  {
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.applicationId, t.tagId] })],
);

export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role"),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  linkedin: text("linkedin"),
  howWeMet: text("how_we_met"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const applicationContacts = sqliteTable(
  "application_contacts",
  {
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Rôle du contact pour cette candidature : recommandation, recruteur, manager… */
    relation: text("relation"),
  },
  (t) => [primaryKey({ columns: [t.applicationId, t.contactId] })],
);

export const interactions = sqliteTable(
  "interactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /** `YYYY-MM-DDTHH:mm`, heure locale. */
    date: text("date").notNull(),
    type: text("type").$type<InteractionType>().notNull(),
    summary: text("summary").notNull(),
    content: text("content"),
    /** Lieu ou lien visio (entretiens). */
    location: text("location"),
    /** Entretiens uniquement : RH, technique, test… (sert au calendrier et au suivi « à planifier »). */
    interviewKind: text("interview_kind").$type<InterviewKind>(),
    /** Durée prévue (entretiens, appels) : fin de l'événement dans le calendrier. */
    durationMinutes: integer("duration_minutes"),
    nextAction: text("next_action"),
    nextActionDate: text("next_action_date"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("interactions_application_idx").on(t.applicationId)],
);

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").$type<DocumentKind>().notNull(),
  label: text("label").notNull(),
  /** Texte du document (lettres) : sert au diff et aux prompts. */
  content: text("content"),
  /** Chemin relatif à `data/documents/`. */
  filePath: text("file_path"),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  isBase: integer("is_base", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

export const applicationDocuments = sqliteTable(
  "application_documents",
  {
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** `YYYY-MM-DD` : date d'envoi de cette version à cette entreprise. */
    sentAt: text("sent_at"),
  },
  (t) => [primaryKey({ columns: [t.applicationId, t.documentId] })],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    dueDate: text("due_date"),
    applicationId: integer("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    interactionId: integer("interaction_id").references(() => interactions.id, {
      onDelete: "set null",
    }),
    origin: text("origin").$type<TaskOrigin>().notNull().default("manual"),
    doneAt: text("done_at"),
    cancelledAt: text("cancelled_at"),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("tasks_application_idx").on(t.applicationId)],
);

export const keywords = sqliteTable(
  "keywords",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    label: text("label").notNull(),
    aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull().default([]),
    category: text("category"),
    /** Compétence que je maîtrise (entre dans le numérateur du score de matching). */
    mine: integer("mine", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("keywords_label_unique").on(t.label)],
);

/** Gabarits de prompts (pour Claude) et de messages (relance, remerciement…), modifiables. */
export const templates = sqliteTable(
  "templates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").$type<TemplateKind>().notNull(),
    /** Identifiant stable du gabarit par défaut (« letter », « thank_you »…). */
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** Objet de l'email (messages uniquement). */
    subject: text("subject"),
    body: text("body").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("templates_kind_key_unique").on(t.kind, t.key)],
);

/** Fiche de préparation d'entretien (une par candidature). */
export const interviewPreps = sqliteTable("interview_preps", {
  applicationId: integer("application_id")
    .primaryKey()
    .references(() => applications.id, { onDelete: "cascade" }),
  companyNotes: text("company_notes"),
  updatedAt: updatedAt(),
});

export const prepQuestions = sqliteTable(
  "prep_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    kind: text("kind").$type<PrepQuestionKind>().notNull(),
    question: text("question").notNull(),
    answer: text("answer"),
    /** Auto-évaluation en mode flashcards : 0 = à revoir, 1 = bien, 2 = parfait. */
    confidence: integer("confidence").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    lastReviewedAt: text("last_reviewed_at"),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("prep_questions_application_idx").on(t.applicationId)],
);

/**
 * Entreprises cibles, repérées (souvent avec Claude) avant de trouver une offre. Le lien avec les
 * candidatures et les contacts se fait par le nom (normalisé), pas par clé étrangère.
 */
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  careersUrl: text("careers_url"),
  location: text("location"),
  sector: text("sector"),
  notes: text("notes"),
  status: text("status").$type<CompanyStatus>().notNull().default("to_explore"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type StatusChange = typeof statusChanges.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Interaction = typeof interactions.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Keyword = typeof keywords.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type PrepQuestion = typeof prepQuestions.$inferSelect;
export type Company = typeof companies.$inferSelect;
