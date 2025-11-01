// src/core/web-search.ts
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import crypto from "node:crypto";

export type WebResult = {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;   // ISO si possible
  source?: string;        // domaine
};

const CACHE_DIR = path.join("data", "_cache", "search");

function ensureCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function hash(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString();
}

function isFresh(ts: string, ttlDays: number) {
  const t = new Date(ts).getTime();
  const ageMs = Date.now() - t;
  return ageMs <= ttlDays * 24 * 3600 * 1000;
}

function domainOf(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function normalize(results: any[], opts: { max: number, freshnessDays?: number, includes?: string[], excludes?: string[], lang?: string }): WebResult[] {
  const out: WebResult[] = [];

  const pushOne = (r: Partial<WebResult>) => {
    if (!r.url || !r.title) return;
    const d = domainOf(r.url);
    if (opts.excludes && opts.excludes.includes(d)) return;
    if (opts.includes && opts.includes.length && !opts.includes.includes(d)) return;

    // fraicheur si l'info est disponible
    if (opts.freshnessDays && r.publishedAt) {
      const dt = new Date(r.publishedAt);
      if (Number.isFinite(dt.getTime())) {
        const age = Date.now() - dt.getTime();
        if (age > opts.freshnessDays * 24 * 3600 * 1000) return;
      }
    }

    out.push({
      title: r.title!,
      url: r.url!,
      snippet: r.snippet || "",
      publishedAt: r.publishedAt,
      source: d
    });
  };

  for (const r of results) pushOne(r);

  // dédup simple par URL
  const seen = new Set<string>();
  const uniq = out.filter(x => {
    if (seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });

  return uniq.slice(0, opts.max);
}

async function fetchJSON(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${txt.slice(0,200)}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Unexpected content-type: ${ct} body=${txt.slice(0,200)}`);
  }
  return res.json();
}

// --- Providers --------------------------------------------------------

async function searchBrave(query: string, max: number, lang?: string) {
  const key = process.env.WEB_SEARCH_KEY;
  if (!key) throw new Error("WEB_SEARCH_KEY is missing for Brave provider");
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}${lang ? `&lang=${lang}` : ""}`;
  const json = await fetchJSON(url, {
    method: "GET",
    headers: { "Accept": "application/json", "X-Subscription-Token": key }
  });
  const web = json.web?.results || [];
  const news = json.news?.results || [];
  const to = (x: any): Partial<WebResult> => ({
    title: x.title,
    url: x.url,
    snippet: x.description || x.snippet,
    publishedAt: x.age || x.published || x.date
  });
  return normalize([...web.map(to), ...news.map(to)], { max, lang, freshnessDays: undefined, includes: undefined, excludes: undefined });
}

async function searchSerpAPI(query: string, max: number, lang?: string) {
  const key = process.env.WEB_SEARCH_KEY;
  if (!key) throw new Error("WEB_SEARCH_KEY is missing for SerpAPI provider");
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&engine=google&num=${max}${lang?`&hl=${lang}`:""}&api_key=${key}`;
  const json = await fetchJSON(url, { method: "GET" });
  const organic = json.organic_results || [];
  const news = json.news_results || [];
  const toOrg = (x: any): Partial<WebResult> => ({
    title: x.title,
    url: x.link,
    snippet: x.snippet || x.description,
    publishedAt: x.date // SerpAPI peut renvoyer "2 days ago" → on laisse brut
  });
  const toNews = (x: any): Partial<WebResult> => ({
    title: x.title,
    url: x.link,
    snippet: x.snippet || x.source,
    publishedAt: x.date
  });
  return normalize([...organic.map(toOrg), ...news.map(toNews)], { max, lang, freshnessDays: undefined, includes: undefined, excludes: undefined });
}

async function searchBing(query: string, max: number, lang?: string) {
  const key = process.env.WEB_SEARCH_KEY;
  if (!key) throw new Error("WEB_SEARCH_KEY is missing for Bing provider");
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${max}${lang?`&setLang=${lang}`:""}`;
  const json = await fetchJSON(url, {
    method: "GET",
    headers: { "Ocp-Apim-Subscription-Key": key }
  });
  const web = json.webPages?.value || [];
  const news = json.news?.value || [];
  const toWeb = (x: any): Partial<WebResult> => ({
    title: x.name,
    url: x.url,
    snippet: x.snippet,
    publishedAt: x.dateLastCrawled
  });
  const toNews = (x: any): Partial<WebResult> => ({
    title: x.name,
    url: x.url,
    snippet: x.description,
    publishedAt: x.datePublished
  });
  return normalize([...web.map(toWeb), ...news.map(toNews)], { max, lang, freshnessDays: undefined, includes: undefined, excludes: undefined });
}

// --- Public API avec cache -------------------------------------------

export async function webSearch(query: string, limit?: number): Promise<WebResult[]> {
  const cfg = loadConfig();
  const ws = cfg.websearch || {};
  const provider = (ws.provider || "mock").toLowerCase();
  const max = limit ?? ws.maxResults ?? 5;
  const ttlDays = ws.ttlDays ?? 7;

  const cacheKey = `${provider}:${ws.language || ""}:${max}:${query}`;
  const file = path.join(CACHE_DIR, `${hash(cacheKey)}.json`);
  ensureCache();

  // 1) Cache hit si frais
  if (fs.existsSync(file)) {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (j && j._cachedAt && isFresh(j._cachedAt, ttlDays)) {
        return j.results as WebResult[];
      }
    } catch {}
  }

  // 2) Fetch provider (ou mock)
  let results: WebResult[] = [];
  try {
    if (provider === "brave") {
      results = await searchBrave(query, max, ws.language);
    } else if (provider === "serpapi") {
      results = await searchSerpAPI(query, max, ws.language);
    } else if (provider === "bing") {
      results = await searchBing(query, max, ws.language);
    } else {
      // MOCK
      results = Array.from({ length: max }, (_, i) => ({
        title: `[Mock] ${query} #${i + 1}`,
        url: `https://example.com/${encodeURIComponent(query)}/${i + 1}`,
        snippet: `Simulated result for "${query}"`,
        publishedAt: nowISO(),
        source: "example.com"
      }));
    }
  } catch (e: any) {
    // En cas d’erreur provider → fallback mock (et on log)
    console.warn("webSearch provider error:", e?.message || e);
    results = Array.from({ length: max }, (_, i) => ({
      title: `[Fallback] ${query} #${i + 1}`,
      url: `https://fallback.local/${encodeURIComponent(query)}/${i + 1}`,
      snippet: `Fallback result for "${query}"`,
      publishedAt: nowISO(),
      source: "fallback.local"
    }));
  }

  // 3) Post-filters (includes/excludes/freshness)
  const filtered = normalize(
    results,
    {
      max,
      freshnessDays: ws.freshnessDays,
      includes: Array.isArray(ws.includeDomains) ? ws.includeDomains : undefined,
      excludes: Array.isArray(ws.excludeDomains) ? ws.excludeDomains : undefined,
      lang: ws.language
    }
  );

  // 4) Write cache
  try {
    fs.writeFileSync(file, JSON.stringify({ _cachedAt: nowISO(), results: filtered }, null, 2), "utf8");
  } catch {}

  return filtered;
}
