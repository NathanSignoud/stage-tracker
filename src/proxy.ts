import { NextResponse, type NextRequest } from "next/server";

// Deux modes :
// - normal (`npm run dev`) : pas de code, mais seules les requêtes faites depuis ce PC sont acceptées.
//   Une requête relayée (tunnel Cloudflare, autre hôte) est refusée : un tunnel lancé par erreur
//   ne peut jamais exposer les données sans code ;
// - protégé (`npm run dev:lan`, `npm run mobile` → STAGE_TRACKER_PROTECTED=1) : code APP_PIN obligatoire.

const COOKIE = "stage_tracker_pin";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Après 5 échecs : blocage 1 min, puis 2, 4, 8… jusqu'à 1 h. Rend la force brute impraticable.
const FAILURES_BEFORE_LOCK = 5;
const MAX_LOCK_MS = 60 * 60_000;
let failures = 0;
let lockLevel = 0;
let lockedUntil = 0;

async function pinDigest(pin: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`stage-tracker:${pin}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeNext(value: FormDataEntryValue | string | null): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function isLocalRequest(request: NextRequest): boolean {
  if (request.headers.has("cf-connecting-ip")) return false; // relayée par Cloudflare
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  return LOCAL_HOSTS.has(host);
}

function isHttps(request: NextRequest): boolean {
  return (
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https" ||
    (request.headers.get("cf-visitor") ?? "").includes('"https"')
  );
}

export async function proxy(request: NextRequest) {
  if (process.env.STAGE_TRACKER_PROTECTED !== "1") {
    if (isLocalRequest(request)) return NextResponse.next();
    return new NextResponse(
      "Accès réservé à ce PC. Pour le téléphone, lance « npm run mobile » ou « npm run dev:lan » (code requis).",
      { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  // Abonnement agenda : protégé par son propre jeton secret (une app d'agenda ne saisit pas de code).
  if (request.nextUrl.pathname.startsWith("/api/calendar/feed/")) return NextResponse.next();

  const pin = process.env.APP_PIN?.trim();
  if (!pin) return new NextResponse("APP_PIN manquant dans .env.local", { status: 500 });
  const expected = await pinDigest(pin);
  if (request.cookies.get(COOKIE)?.value === expected) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname !== "/pin") {
    const url = new URL("/pin", request.url);
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const next = safeNext(form.get("next"));
    const back = new URL("/pin", request.url);
    back.searchParams.set("next", next);
    if (Date.now() < lockedUntil) {
      back.searchParams.set("erreur", "bloque");
      return NextResponse.redirect(back, 303);
    }
    if (form.get("pin") === pin) {
      failures = 0;
      lockLevel = 0;
      const res = NextResponse.redirect(new URL(next, request.url), 303);
      res.cookies.set(COOKIE, expected, {
        httpOnly: true,
        sameSite: "lax",
        secure: isHttps(request),
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    }
    if (++failures >= FAILURES_BEFORE_LOCK) {
      failures = 0;
      lockedUntil = Date.now() + Math.min(60_000 * 2 ** lockLevel, MAX_LOCK_MS);
      lockLevel++;
    }
    back.searchParams.set("erreur", "1");
    return NextResponse.redirect(back, 303);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon).*)"],
};
