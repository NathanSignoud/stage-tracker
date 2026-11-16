import { eq } from "drizzle-orm";
import type { Conn } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/domain/settings";

export function getSettings(conn: Conn): AppSettings {
  const stored = Object.fromEntries(
    conn.select().from(settings).all().map((row) => [row.key, row.value]),
  ) as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(
      Object.keys(DEFAULT_SETTINGS)
        .filter((key) => key in stored)
        .map((key) => [key, stored[key as keyof AppSettings]]),
    ),
    profile: { ...DEFAULT_SETTINGS.profile, ...stored.profile },
  };
}

export function setSetting(conn: Conn, key: string, value: unknown): void {
  conn
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function updateSettings(conn: Conn, patch: Partial<AppSettings>): void {
  for (const [key, value] of Object.entries(patch)) setSetting(conn, key, value);
}

export function getRawSetting<T>(conn: Conn, key: string): T | undefined {
  return conn.select().from(settings).where(eq(settings.key, key)).get()?.value as T | undefined;
}
