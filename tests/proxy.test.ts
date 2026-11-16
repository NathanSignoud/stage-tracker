import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Le compteur de blocage vit dans le module : on le recharge à neuf pour chaque test.
async function loadProxy() {
  vi.resetModules();
  return (await import("@/proxy")).proxy;
}

const request = (url: string, init: { host?: string; headers?: Record<string, string>; method?: string; body?: URLSearchParams } = {}) =>
  new NextRequest(url, {
    method: init.method ?? "GET",
    body: init.body,
    headers: { host: init.host ?? new URL(url).host, ...init.headers },
  });

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";
const pinPost = (pin: string) => request("https://abc.trycloudflare.com/pin", { method: "POST", body: new URLSearchParams({ pin, next: "/taches" }) });

afterEach(() => vi.unstubAllEnvs());

describe("accès local (npm run dev)", () => {
  beforeEach(() => vi.stubEnv("STAGE_TRACKER_PROTECTED", ""));

  it("laisse passer ce PC", async () => {
    const proxy = await loadProxy();
    expect(passes(await proxy(request("http://127.0.0.1:3000/")))).toBe(true);
    expect(passes(await proxy(request("http://localhost:3000/candidatures")))).toBe(true);
  });

  it("refuse toute requête relayée ou venant d'un autre hôte", async () => {
    const proxy = await loadProxy();
    expect((await proxy(request("https://abc.trycloudflare.com/"))).status).toBe(403);
    expect((await proxy(request("http://127.0.0.1:3000/", { headers: { "cf-connecting-ip": "1.2.3.4" } }))).status).toBe(403);
  });
});

describe("mode protégé (npm run mobile)", () => {
  beforeEach(() => {
    vi.stubEnv("STAGE_TRACKER_PROTECTED", "1");
    vi.stubEnv("APP_PIN", "482915");
  });

  it("exige le code, puis laisse passer avec le cookie", async () => {
    const proxy = await loadProxy();
    const blocked = await proxy(request("https://abc.trycloudflare.com/taches"));
    expect(blocked.headers.get("location")).toBe("https://abc.trycloudflare.com/pin?next=%2Ftaches");

    const ok = await proxy(pinPost("482915"));
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("https://abc.trycloudflare.com/taches");
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    expect(passes(await proxy(request("https://abc.trycloudflare.com/taches", { headers: { cookie } })))).toBe(true);
  });

  it("bloque après 5 mauvais codes, même si le 6e est bon", async () => {
    const proxy = await loadProxy();
    for (let i = 0; i < 5; i++) expect((await proxy(pinPost("000000"))).headers.get("location")).toContain("erreur=1");
    expect((await proxy(pinPost("482915"))).headers.get("location")).toContain("erreur=bloque");
  });

  it("laisse passer l'abonnement agenda (protégé par son propre jeton)", async () => {
    const proxy = await loadProxy();
    expect(passes(await proxy(request("https://abc.trycloudflare.com/api/calendar/feed/abc.ics")))).toBe(true);
  });
});
