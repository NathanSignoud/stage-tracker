import { Download } from "lucide-react";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/page-header";
import { BackupNowButton, SettingsForm } from "@/components/settings-form";
import { KeywordsManager } from "@/components/settings/keywords-manager";
import { TemplatesEditor } from "@/components/settings/templates-editor";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { listBackups } from "@/lib/backup";
import { formatDayTime, localDateTime } from "@/lib/dates";
import { BACKUP_DIR, DATA_DIR } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { listKeywords } from "@/server/services/keywords";
import { getSettings } from "@/server/services/settings";
import { listTemplates } from "@/server/services/templates";

export const metadata = { title: "Réglages" };

const TABS = [
  ["profil", "Profil et suivi"],
  ["mots-cles", "Mots-clés"],
  ["gabarits", "Gabarits"],
  ["sauvegardes", "Sauvegardes"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function SettingsPage({ searchParams }: PageProps<"/reglages">) {
  const { onglet } = await searchParams;
  const tab: Tab = TABS.some(([key]) => key === onglet) ? (onglet as Tab) : "profil";
  const db = getDb();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Réglages" />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b" aria-label="Sections des réglages">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/reglages?onglet=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 border-transparent px-3 py-2 text-[13px] whitespace-nowrap text-muted-foreground hover:text-foreground",
              tab === key && "border-foreground font-medium text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "profil" && <SettingsForm settings={getSettings(db)} />}
      {tab === "mots-cles" && <KeywordsManager keywords={listKeywords(db)} />}
      {tab === "gabarits" && <TemplatesEditor templates={listTemplates(db)} />}
      {tab === "sauvegardes" && <Backups />}
    </div>
  );
}

function Backups() {
  const backups = listBackups(BACKUP_DIR).slice(0, 15);
  return (
    <Panel
      title="Sauvegardes"
      actions={
        <>
          <Button variant="ghost" size="sm" asChild>
            <a href="/api/backup">
              <Download /> Télécharger (JSON)
            </a>
          </Button>
          <BackupNowButton />
        </>
      }
    >
      <div className="grid gap-2 py-2 text-[13px]">
        <p className="text-muted-foreground">
          Données : <code className="rounded bg-muted px-1 text-xs">{DATA_DIR}</code>. Une sauvegarde automatique est faite à chaque
          démarrage (10 conservées). Pour restaurer :{" "}
          <code className="rounded bg-muted px-1 text-xs">npm run restore -- data/backups/&lt;fichier&gt;.json</code>
        </p>
        <ul className="divide-y rounded-md border">
          {backups.map((b) => (
            <li key={b.name} className="flex items-center gap-3 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{b.name}</span>
              <span className="text-xs text-muted-foreground">{Math.max(1, Math.round(b.size / 1024))} Ko</span>
              <span className="w-36 text-right text-xs text-muted-foreground">{formatDayTime(localDateTime(new Date(b.modifiedAt)))}</span>
            </li>
          ))}
          {backups.length === 0 && <li className="px-3 py-2 text-muted-foreground">Aucune sauvegarde pour l&apos;instant.</li>}
        </ul>
      </div>
    </Panel>
  );
}
