// npm run dev:lan : comme `npm run dev`, mais accessible depuis le réseau local (téléphone),
// protégé par le code APP_PIN de .env.local (vérifié par src/proxy.ts).
// Si le pare-feu Windows bloque le téléphone (pas de droits admin) : `npm run mobile`.
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fichier absent : signalé juste en dessous.
}

const pin = process.env.APP_PIN?.trim();
if (!pin || pin.length < 6) {
  console.error(
    "Mode réseau refusé : définis un code d'au moins 6 caractères dans .env.local, par exemple :\n\n" +
      "  APP_PIN=482915\n",
  );
  process.exit(1);
}

const port = process.env.PORT ?? "3000";
const addresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => `http://${i!.address}:${port}`);
console.log(`\nAccessible sur le réseau local (code requis) :\n${addresses.map((a) => `  ${a}`).join("\n")}\n`);

const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev", "-H", "0.0.0.0", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, STAGE_TRACKER_PROTECTED: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
// Arrêter le lanceur arrête aussi le serveur Next (sinon il resterait seul sur le port).
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => child.kill(signal));
}
process.on("exit", () => child.kill());
