import { parseOfferHtml, robotsAllows, type ImportedOffer } from "@/lib/domain/offer-parsing";

// Lecture ponctuelle d'UNE page d'offre dont l'utilisateur colle le lien. Pas de scraping :
// robots.txt est respecté, LinkedIn (qui interdit la lecture automatique) est refusé d'office.

const USER_AGENT = "StageTracker/1.0 (outil personnel de suivi de candidatures)";
const MAX_BYTES = 3_000_000;
const REFUSED_HOSTS = [/(^|\.)linkedin\.com$/i];
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|.*\.local$)/i;

export class OfferImportError extends Error {}

function checkHost(url: URL): void {
  if (REFUSED_HOSTS.some((r) => r.test(url.hostname))) {
    throw new OfferImportError("LinkedIn interdit la lecture automatique de ses pages : copie-colle le texte de l'offre.");
  }
  if (PRIVATE_HOST.test(url.hostname)) throw new OfferImportError("Adresse locale refusée.");
}

const MAX_REDIRECTS = 5;

/** Suit les redirections une à une pour vérifier chaque adresse AVANT de la contacter. */
async function get(url: string, timeoutMs: number): Promise<{ res: Response; finalUrl: string }> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    checkHost(current);
    const res = await fetch(current, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
      signal,
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return { res, finalUrl: current.href };
    current = new URL(location, current);
  }
  throw new OfferImportError("Trop de redirections : copie-colle le texte de l'offre.");
}

export async function importOfferFromUrl(raw: string): Promise<ImportedOffer & { url: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new OfferImportError("Lien invalide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new OfferImportError("Lien invalide (http ou https).");

  try {
    const { res: robots } = await get(`${url.origin}/robots.txt`, 5_000);
    if (robots.ok && !robotsAllows(await robots.text(), url.pathname + url.search)) {
      throw new OfferImportError("Ce site interdit la lecture automatique de cette page : copie-colle le texte de l'offre.");
    }
  } catch (error) {
    if (error instanceof OfferImportError) throw error;
    // robots.txt injoignable : traité comme absent.
  }

  let res: Response;
  let finalUrl: string;
  try {
    ({ res, finalUrl } = await get(url.href, 12_000));
  } catch (error) {
    if (error instanceof OfferImportError) throw error;
    throw new OfferImportError("Page injoignable (délai dépassé ou site hors ligne).");
  }
  if (!res.ok) throw new OfferImportError(`La page a répondu ${res.status} : copie-colle le texte de l'offre.`);
  if (!(res.headers.get("content-type") ?? "").includes("html")) throw new OfferImportError("Ce lien n'est pas une page web.");
  const html = await res.text();
  if (html.length > MAX_BYTES) throw new OfferImportError("Page trop volumineuse.");

  const offer = parseOfferHtml(html);
  if (!offer.title && !offer.offerText) {
    throw new OfferImportError("Impossible de lire cette page (contenu chargé dynamiquement ?) : copie-colle le texte de l'offre.");
  }
  return { ...offer, url: finalUrl };
}
