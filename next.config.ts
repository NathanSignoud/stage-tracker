import type { NextConfig } from "next";
import os from "node:os";

// Adresses IPv4 du PC sur le réseau local : nécessaires pour ouvrir l'app depuis
// le téléphone en mode `npm run dev:lan` (le serveur de dev bloque sinon ses propres assets).
function lanHosts(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

// Cache Components est volontairement désactivé : app locale mono-utilisateur sur SQLite
// synchrone, toutes les pages sont rendues à la requête (voir CLAUDE.md).
const nextConfig: NextConfig = {
  // Permet de compiler ailleurs (tests) sans toucher au .next d'un `npm run mobile` en cours.
  distDir: process.env.STAGE_TRACKER_DIST_DIR || ".next",
  // L'app tourne en permanence en mode dev : l'indicateur Next masquerait le bas de la barre latérale.
  devIndicators: false,
  serverExternalPackages: ["better-sqlite3", "unpdf", "mammoth"],
  // En mode réseau (-H 0.0.0.0), Next n'autorise d'office que « localhost » : on ajoute 127.0.0.1
  // (navigateur du PC) et les adresses du PC sur le réseau (téléphone).
  allowedDevOrigins: ["127.0.0.1", ...lanHosts()],
  experimental: {
    serverActions: {
      // Envoi de CV/lettres en PDF depuis la fiche candidature.
      bodySizeLimit: "25mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
