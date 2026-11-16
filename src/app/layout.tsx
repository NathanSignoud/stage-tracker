import type { Metadata, Viewport } from "next";
import { Geist_Mono, Onest, Unbounded } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const onest = Onest({ variable: "--font-sans", subsets: ["latin"] });
// Titres et grands chiffres uniquement (police large, peu lisible en petit).
const unbounded = Unbounded({ variable: "--font-display", subsets: ["latin"], weight: ["500", "700"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Stage Tracker", template: "%s · Stage Tracker" },
  description: "Suivi local de mes candidatures de stage",
  applicationName: "Stage Tracker",
  // iPhone : « Sur l'écran d'accueil » ouvre l'app en plein écran, sans barre Safari.
  appleWebApp: { capable: true, title: "Stages", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#121019" },
  ],
  // Barre d'onglets du téléphone : on gère nous-mêmes la zone de la barre d'accueil (safe-area).
  viewportFit: "cover",
};

// Toutes les pages lisent la base SQLite locale : rendu à chaque requête, jamais figé au build.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${onest.variable} ${unbounded.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-sm text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
