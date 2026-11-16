import { revalidatePath } from "next/cache";
import { z } from "zod";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Exécute une mutation et rafraîchit toutes les pages (l'app est petite : pas de
 * revalidation fine). Les erreurs deviennent un message affichable en toast.
 */
export function mutate<T>(fn: () => T): ActionResult<T> {
  try {
    const data = fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Saisie invalide";
  if (error instanceof Error) return error.message;
  return "Erreur inattendue";
}
