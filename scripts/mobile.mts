// npm run mobile : accès depuis le téléphone, partout (Wi-Fi ou 4G), via un tunnel Cloudflare.
// Le PC ouvre une connexion SORTANTE vers Cloudflare : aucun port à ouvrir, aucun droit administrateur.
// L'app est compilée en mode production, n'écoute que sur 127.0.0.1, et exige le code APP_PIN.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import QRCode from "qrcode";

// Version figée + empreinte publiée par Cloudflare (notes de version GitHub) : le binaire est vérifié.
const CLOUDFLARED_VERSION = "2026.10.1";
const CLOUDFLARED_SHA256 = "4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6"; // windows-amd64
const TOOLS_DIR = path.join(process.cwd(), ".tools");
const PORT = process.env.PORT ?? "3000";
const NEXT_BIN = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Chemin de cloudflared : téléchargé et vérifié dans .tools/ (Windows), sinon celui du PATH. */
async function ensureCloudflared(): Promise<string> {
  if (process.platform !== "win32" || process.arch !== "x64") return "cloudflared";
  const exe = path.join(TOOLS_DIR, `cloudflared-${CLOUDFLARED_VERSION}.exe`);
  if (fs.existsSync(exe) && sha256(exe) === CLOUDFLARED_SHA256) return exe;

  const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe`;
  console.log(`↓ Téléchargement de cloudflared ${CLOUDFLARED_VERSION} (≈ 55 Mo, une seule fois)…`);
  const res = await fetch(url);
  if (!res.ok) fail(`Téléchargement de cloudflared impossible (HTTP ${res.status}).`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== CLOUDFLARED_SHA256) fail("Empreinte SHA-256 de cloudflared incorrecte : fichier refusé.");
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  fs.writeFileSync(exe, bytes);
  console.log("✓ cloudflared vérifié (SHA-256)");
  return exe;
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

// --- Vérifications ------------------------------------------------------------

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fichier absent : signalé juste en dessous.
}
const pin = process.env.APP_PIN?.trim();
if (!pin || pin.length < 6) {
  fail("Définis un code d'au moins 6 caractères dans .env.local, par exemple :  APP_PIN=482915");
}
if (!(await portIsFree(Number(PORT)))) {
  fail(`Le port ${PORT} est déjà utilisé (npm run dev ou dev:lan encore ouvert ?). Arrête-le d'abord (Ctrl+C).`);
}

const cloudflared = await ensureCloudflared();

console.log("⚙ Compilation de l'app en mode production (≈ 1 min)…");
const build = spawnSync(process.execPath, [NEXT_BIN, "build"], { stdio: "inherit" });
if (build.status !== 0) fail("La compilation a échoué.");

// --- Lancement ------------------------------------------------------------------

const children: ChildProcess[] = [];
const stopAll = () => children.forEach((c) => c.kill());
process.on("exit", stopAll);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    stopAll();
    process.exit(0);
  });
}

const app = spawn(process.execPath, [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", PORT], {
  stdio: "inherit",
  env: { ...process.env, STAGE_TRACKER_PROTECTED: "1" },
});
children.push(app);
app.on("exit", (code) => {
  console.error(`Le serveur s'est arrêté (code ${code}).`);
  stopAll();
  process.exit(code ?? 1);
});

const tunnel = spawn(cloudflared, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${PORT}`], {
  stdio: ["ignore", "pipe", "pipe"],
});
children.push(tunnel);
tunnel.on("error", (e) => fail(`cloudflared n'a pas pu démarrer : ${e.message}`));
tunnel.on("exit", (code) => {
  console.error(`Le tunnel Cloudflare s'est arrêté (code ${code}).`);
  stopAll();
  process.exit(code ?? 1);
});

let announced = false;
const onTunnelOutput = async (chunk: Buffer) => {
  const text = chunk.toString();
  // Les erreurs du tunnel restent visibles ; le reste de son journal est masqué.
  for (const line of text.split(/\r?\n/)) if (/\bERR\b/.test(line)) console.error(`[tunnel] ${line}`);
  const url = text.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/)?.[0];
  if (!url || announced) return;
  announced = true;
  const qr = await QRCode.toString(url, { type: "terminal", small: true });
  console.log(
    `\n${"─".repeat(64)}\n` +
      `  📱 Stage Tracker est accessible depuis ton téléphone :\n\n     ${url}\n\n` +
      `  Scanne ce QR code avec l'appareil photo, puis saisis ton code.\n` +
      `  L'adresse change à chaque lancement. Ctrl+C pour tout arrêter.\n` +
      `${"─".repeat(64)}\n${qr}`,
  );
};
tunnel.stdout!.on("data", onTunnelOutput);
tunnel.stderr!.on("data", onTunnelOutput);
