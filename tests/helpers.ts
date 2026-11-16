import { openDb } from "@/db";
import type { ApplicationInput } from "@/lib/validation";

/** Base SQLite en mémoire, migrée, isolée pour chaque test. */
export function testDb() {
  return openDb(":memory:");
}

/** Date locale fixe (midi, pour éviter tout effet de fuseau). */
export function at(day: string, time = "12:00"): Date {
  return new Date(`${day}T${time}:00`);
}

export function appInput(overrides: Partial<ApplicationInput> = {}): ApplicationInput {
  return {
    company: "Acme AI",
    title: "Stage ML",
    offerUrl: null,
    offerText: null,
    source: null,
    location: null,
    remote: null,
    duration: null,
    startDate: null,
    stipend: null,
    deadline: null,
    sentDate: null,
    priority: 2,
    notes: null,
    ...overrides,
  };
}
