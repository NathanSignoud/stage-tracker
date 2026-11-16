"use client";

import {
  Briefcase,
  Building2,
  CalendarDays,
  CheckSquare,
  Ellipsis,
  FileText,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  SunMedium,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { CommandSearch } from "@/components/command-search";
import { ScheduleInterviewDialog } from "@/components/interviews/schedule-interview-dialog";
import { MessageDialog } from "@/components/messages/message-dialog";
import { useUi } from "@/components/providers";
import { QuickAddDialog } from "@/components/quick-add-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof SunMedium };

const NAV: NavItem[] = [
  { href: "/", label: "Aujourd'hui", icon: SunMedium },
  { href: "/candidatures", label: "Candidatures", icon: Briefcase },
  { href: "/entreprises", label: "Entreprises", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/calendrier", label: "Calendrier", icon: CalendarDays },
  { href: "/taches", label: "Tâches", icon: CheckSquare },
  { href: "/documents", label: "Documents", icon: FileText },
];

const NAV_MORE: NavItem[] = [
  { href: "/reglages", label: "Réglages", icon: Settings },
  { href: "/corbeille", label: "Corbeille", icon: Trash2 },
];

/** Onglets du téléphone : les 2 pages du quotidien + le calendrier ; le reste est dans « Plus ». */
const TABS = ["/", "/candidatures", "/calendrier"];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
}

function Brand() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-1 rounded-lg font-heading text-[15px] font-bold tracking-tight">
      stage
      <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground" />
      tracker
    </Link>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Changer de thème"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}

/** Ordinateur : navigation en pilule ; libellés à partir de 1360 px, icônes seules (avec infobulle) en dessous. */
function TopNav() {
  const isActive = useIsActive();
  return (
    <nav aria-label="Navigation principale" className="hidden min-w-0 items-center gap-0.5 rounded-full bg-card p-1 ring-1 ring-border lg:flex">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2 rounded-full px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-primary font-medium text-primary-foreground hover:bg-primary hover:text-primary-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="sr-only min-[1360px]:not-sr-only">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function MoreMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Plus : réglages, corbeille" className="hidden lg:inline-flex">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {NAV_MORE.map(({ href, label, icon: Icon }) => (
          <DropdownMenuItem key={href} asChild>
            <Link href={href}>
              <Icon /> {label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Téléphone et tablette : barre d'onglets en bas, à portée de pouce, avec l'ajout au centre. */
function BottomTabs() {
  const isActive = useIsActive();
  const { setQuickAddOpen } = useUi();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = NAV.filter((n) => TABS.includes(n.href));
  const others = [...NAV.filter((n) => !TABS.includes(n.href)), ...NAV_MORE];
  const moreActive = others.some((n) => isActive(n.href));

  const tab = ({ href, label, icon: Icon }: NavItem) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-1.5 text-[11px] text-muted-foreground",
          active && "font-semibold text-foreground",
        )}
      >
        <span className={cn("grid h-7 w-12 place-items-center rounded-full", active && "bg-tile-interview")}>
          <Icon className="size-5" />
        </span>
        <span className="truncate">{label}</span>
      </Link>
    );
  };

  return (
    <>
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex h-16 max-w-lg items-center gap-1 px-2">
          {tabs.slice(0, 2).map(tab)}
          <div className="flex flex-1 justify-center">
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              aria-label="Nouvelle candidature"
              className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
            >
              <Plus className="size-6" />
            </button>
          </div>
          {tabs.slice(2).map(tab)}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-1.5 text-[11px] text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              moreActive && "font-semibold text-foreground",
            )}
          >
            <span className={cn("grid h-7 w-12 place-items-center rounded-full", moreActive && "bg-tile-interview")}>
              <Ellipsis className="size-5" />
            </span>
            Plus
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetTitle className="px-5 pt-5 font-heading text-base">Plus</SheetTitle>
          <div className="grid grid-cols-3 gap-2 p-4">
            {others.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMoreOpen(false)}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl bg-muted text-[13px] font-medium",
                  isActive(href) && "bg-tile-interview",
                )}
              >
                <Icon className="size-5" />
                {label}
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { setQuickAddOpen, setSearchOpen } = useUi();

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#contenu"
        className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Aller au contenu
      </a>
      <header className="sticky top-0 z-30 border-b border-transparent bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex h-16 items-center gap-3 px-4 md:px-6 xl:gap-4">
          <Brand />
          <TopNav />
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Rechercher (Ctrl K)"
            className="flex size-10 shrink-0 items-center justify-center gap-2 rounded-full bg-card text-muted-foreground ring-1 ring-border transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 2xl:w-56 2xl:justify-start 2xl:px-4"
          >
            <Search className="size-4 shrink-0" />
            <span className="hidden flex-1 text-left text-[13px] 2xl:inline">Rechercher</span>
            <kbd className="hidden rounded-md bg-muted px-1.5 font-mono text-[10px] 2xl:inline">Ctrl K</kbd>
          </button>
          <Button onClick={() => setQuickAddOpen(true)} className="hidden h-10 px-4 lg:inline-flex" aria-label="Nouvelle candidature (N)">
            <Plus />
            <span className="2xl:hidden">Nouvelle</span>
            <span className="hidden 2xl:inline">Nouvelle candidature</span>
          </Button>
          <ThemeToggle />
          <MoreMenu />
        </div>
      </header>

      {/* pb : la barre d'onglets du téléphone ne doit jamais masquer la fin de la page. */}
      <main id="contenu" tabIndex={-1} className="min-w-0 flex-1 px-4 outline-none pt-2 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-6 lg:pt-4 lg:pb-10">{children}</main>

      <BottomTabs />
      <QuickAddDialog />
      <CommandSearch />
      <ScheduleInterviewDialog />
      <MessageDialog />
    </div>
  );
}
