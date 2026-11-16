import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata = { title: "Code d'accès" };

// Formulaire HTML classique : le POST est traité par src/proxy.ts (aucune donnée lue ici).
export default async function PinPage({ searchParams }: PageProps<"/pin">) {
  const { next, erreur } = await searchParams;
  return (
    <div className="grid min-h-svh place-items-center p-4">
      <form method="post" action="/pin" className="grid w-full max-w-xs gap-3 rounded-3xl bg-card ring-1 ring-border p-6">
        <div className="flex items-center gap-2 font-medium">
          <Lock className="size-4" /> <span className="font-heading">stage tracker</span>
        </div>
        <p className="text-[13px] text-muted-foreground">Accès à distance : saisis le code défini dans .env.local.</p>
        <input type="hidden" name="next" value={typeof next === "string" ? next : "/"} />
        <Input name="pin" type="password" inputMode="numeric" autoComplete="current-password" autoFocus required />
        {erreur && (
          <p className="text-[13px] text-destructive">
            {erreur === "bloque" ? "Trop d'essais : accès bloqué temporairement, réessaie plus tard." : "Code incorrect."}
          </p>
        )}
        <Button type="submit">Entrer</Button>
      </form>
    </div>
  );
}
