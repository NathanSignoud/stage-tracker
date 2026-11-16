"use client";

import { CalendarSync, Check, Copy, Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/use-action";
import { copyText } from "@/lib/clipboard";
import { regenerateCalendarTokenAction } from "@/server/actions/records";

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-1.5">
      <Input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="h-8 font-mono text-[11px]" />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Copier"
        onClick={async () => {
          await copyText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 rounded-lg border p-3">
      <h3 className="text-[13px] font-medium">{title}</h3>
      {children}
    </section>
  );
}

export function ConnectCalendarDialog({
  feedPath,
  host,
  port,
  lanHosts,
}: {
  feedPath: string;
  /** Hôte utilisé par le navigateur (127.0.0.1:3000 sur le PC, 192.168.x.x:3000 depuis le téléphone). */
  host: string;
  port: string;
  lanHosts: string[];
}) {
  const { pending, run } = useAction();
  const localUrl = `http://127.0.0.1:${port}${feedPath}`;
  const lanUrls = lanHosts.map((h) => `webcal://${h}:${port}${feedPath}`);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <CalendarSync /> Connecter mon agenda
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Connecter Apple Calendrier et Outlook</DialogTitle>
          <DialogDescription>
            Un abonnement fait apparaître tes entretiens et dates limites dans ton agenda, mis à jour automatiquement
            tant que Stage Tracker tourne et que l&apos;appareil peut joindre ce PC.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 text-[13px]">
          <Step title="Sur cet appareil, en un clic">
            <p className="text-muted-foreground">
              Ouvre l&apos;abonnement dans l&apos;application d&apos;agenda par défaut (Outlook sur ce PC, Apple Calendrier sur
              iPhone si tu consultes l&apos;app depuis le téléphone).
            </p>
            <Button asChild variant="outline" size="sm" className="w-fit">
              <a href={`webcal://${host}${feedPath}`}>
                <CalendarSync /> S&apos;abonner sur cet appareil
              </a>
            </Button>
          </Step>

          <Step title="Outlook sur ce PC (application Windows classique)">
            <p className="text-muted-foreground">
              Calendrier → <b>Ajouter un calendrier</b> (ou Ouvrir le calendrier) → <b>À partir d&apos;Internet</b>, puis colle :
            </p>
            <CopyField value={localUrl} />
          </Step>

          <Step title="iPhone (Apple Calendrier)">
            <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
              <li>
                Sur le PC, lance <code className="rounded bg-muted px-1 text-xs">npm run dev:lan</code> (même Wi-Fi que l&apos;iPhone).
              </li>
              <li>
                Sur l&apos;iPhone : Réglages → Calendrier → Comptes → Ajouter un compte → Autre → <b>Ajouter un calendrier avec abonnement</b>, puis colle :
              </li>
            </ol>
            {lanUrls.length ? lanUrls.map((u) => <CopyField key={u} value={u} />) : (
              <p className="text-muted-foreground">Aucune adresse réseau détectée sur ce PC.</p>
            )}
            <p className="text-xs text-muted-foreground">
              L&apos;iPhone rafraîchit l&apos;abonnement quand il est sur ce Wi-Fi et que l&apos;app tourne. Crée-le « sur l&apos;iPhone » et
              non dans iCloud : les serveurs d&apos;Apple ne peuvent pas joindre ton PC.
            </p>
          </Step>

          <Step title="Outlook web, nouvel Outlook, Google Agenda…">
            <p className="text-muted-foreground">
              Ces services lisent les abonnements depuis leurs propres serveurs, qui ne peuvent pas joindre ton PC. Utilise
              plutôt l&apos;import d&apos;un fichier (à refaire après des changements), ou le bouton <b>Agenda</b> de chaque entretien.
            </p>
            <Button asChild variant="outline" size="sm" className="w-fit">
              <a href="/api/calendar/export">
                <Download /> Télécharger le fichier .ics
              </a>
            </Button>
          </Step>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Le lien contient une clé secrète : ne le partage pas.</span>
            <ConfirmButton
              title="Régénérer le lien d'abonnement ?"
              description="Les agendas abonnés avec l'ancien lien cesseront de se mettre à jour : il faudra s'abonner à nouveau."
              confirmLabel="Régénérer"
              onConfirm={() => run(() => regenerateCalendarTokenAction(), { success: "Nouveau lien créé" })}
            >
              <Button variant="ghost" size="xs" disabled={pending}>
                <RefreshCw /> Régénérer le lien
              </Button>
            </ConfirmButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
