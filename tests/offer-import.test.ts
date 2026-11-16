import { afterEach, describe, expect, it, vi } from "vitest";
import { importOfferFromUrl } from "@/server/services/offer-import";

const html = `<html><head><title>Stage ML</title><script type="application/ld+json">
{"@type":"JobPosting","title":"Stage ML Engineer","hiringOrganization":{"name":"Acme"},"description":"Python, PyTorch"}
</script></head><body></body></html>`;

function stubFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    return route ? route() : new Response("", { status: 404 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("import d'offre par lien", () => {
  it("lit une page d'offre et suit une redirection publique", async () => {
    stubFetch({
      "https://jobs.example.com/o/1": () => new Response(null, { status: 302, headers: { location: "/offres/stage-ml" } }),
      "https://jobs.example.com/offres/stage-ml": () => new Response(html, { headers: { "content-type": "text/html" } }),
    });
    const offer = await importOfferFromUrl("https://jobs.example.com/o/1");
    expect(offer.title).toBe("Stage ML Engineer");
    expect(offer.url).toBe("https://jobs.example.com/offres/stage-ml");
  });

  it("refuse une redirection vers une adresse locale sans la contacter", async () => {
    const calls = stubFetch({
      "https://jobs.example.com/o/2": () => new Response(null, { status: 301, headers: { location: "http://192.168.1.1/reboot" } }),
    });
    await expect(importOfferFromUrl("https://jobs.example.com/o/2")).rejects.toThrow("Adresse locale refusée");
    expect(calls.some((u) => u.includes("192.168.1.1"))).toBe(false);
  });

  it("refuse LinkedIn sans aucune requête", async () => {
    const calls = stubFetch({});
    await expect(importOfferFromUrl("https://www.linkedin.com/jobs/view/1")).rejects.toThrow(/LinkedIn/);
    expect(calls).toEqual([]);
  });
});
