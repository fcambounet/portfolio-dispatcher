// src/core/web-search.ts
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import crypto from "node:crypto";

let _lastCall = 0;
let _madeThisRun = 0;
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function getRetryAfterMs(headers: Headers): number | null {
  const ra = headers.get("retry-after");
  if (!ra) return null;
  const n = Number(ra);
  if (Number.isFinite(n)) return n * 1000;
  const dt = Date.parse(ra);
  return Number.isFinite(dt) ? Math.max(0, dt - Date.now()) : null;
}

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

async function fetchJSON(url: string, init: RequestInit, cfg?: any): Promise<any> {
  const rate = Math.max(1, cfg?.websearch?.rateLimitPerSecond ?? 1);
  const minGap = 1000 / rate;

  // spacing anti-429
  const since = Date.now() - _lastCall;
  if (since < minGap) await sleep(minGap - since);

  let attempt = 0;
  while (attempt < 3) {
    const res = await fetch(url, init);
    _lastCall = Date.now();

    if (res.status === 429) {
      const mode = (cfg?.websearch?.on429 ?? "fallback").toLowerCase();
      const raMs = getRetryAfterMs(res.headers) ?? 1200; // ~1.2s par défaut
      attempt++;
      if (mode === "retry" && attempt < 3) {
        await sleep(raMs);
        continue;
      }
      if (mode === "fallback") {
        throw Object.assign(new Error("RATE_LIMITED_FALLBACK"), { status: 429 });
      }
      // mode "error"
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP 429 Too Many Requests: ${txt.slice(0,200)}`);
    }

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
  throw new Error("Max retries reached");
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
  const maxRun = Math.max(1, ws.maxRequestsPerRun ?? 20);

  const cacheKey = `${provider}:${ws.language || ""}:${max}:${query}`;
  const file = path.join(CACHE_DIR, `${hash(cacheKey)}.json`);
  ensureCache();

  // cache
  if (fs.existsSync(file)) {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (j?._cachedAt && isFresh(j._cachedAt, ttlDays)) return j.results as WebResult[];
    } catch {}
  }

  // 🔒 quota par run
  if (_madeThisRun >= maxRun) {
    console.warn(`[webSearch] maxRequestsPerRun reached (${maxRun}) → using fallback mock`);
    return mockResults(query, max);
  }

  let results: WebResult[] = [];
  try {
    _madeThisRun++;
    if (provider === "brave") {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}${ws.language?`&lang=${ws.language}`:""}`;
      const json = await fetchJSON(url, { method: "GET", headers: { "Accept": "application/json", "X-Subscription-Token": process.env.WEB_SEARCH_KEY! } }, { websearch: ws });
      const web = json.web?.results || [];
      const news = json.news?.results || [];
      const to = (x: any): Partial<WebResult> => ({ title: x.title, url: x.url, snippet: x.description || x.snippet, publishedAt: x.age || x.published || x.date });
      results = normalize([...web.map(to), ...news.map(to)], { max, lang: ws.language, freshnessDays: ws.freshnessDays, includes: ws.includeDomains, excludes: ws.excludeDomains });
    } else if (provider === "serpapi") {
      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&engine=google&num=${max}${ws.language?`&hl=${ws.language}`:""}&api_key=${process.env.WEB_SEARCH_KEY}`;
      const json = await fetchJSON(url, { method: "GET" }, { websearch: ws });
      const org = json.organic_results || [];
      const news = json.news_results || [];
      const toOrg = (x: any): Partial<WebResult> => ({ title: x.title, url: x.link, snippet: x.snippet || x.description, publishedAt: x.date });
      const toNews = (x: any): Partial<WebResult> => ({ title: x.title, url: x.link, snippet: x.snippet || x.source, publishedAt: x.date });
      results = normalize([...org.map(toOrg), ...news.map(toNews)], { max, lang: ws.language, freshnessDays: ws.freshnessDays, includes: ws.includeDomains, excludes: ws.excludeDomains });
    } else if (provider === "bing") {
      const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${max}${ws.language?`&setLang=${ws.language}`:""}`;
      const json = await fetchJSON(url, { method: "GET", headers: { "Ocp-Apim-Subscription-Key": process.env.WEB_SEARCH_KEY! } }, { websearch: ws });
      const web = json.webPages?.value || [];
      const news = json.news?.value || [];
      const toWeb = (x: any): Partial<WebResult> => ({ title: x.name, url: x.url, snippet: x.snippet, publishedAt: x.dateLastCrawled });
      const toNews = (x: any): Partial<WebResult> => ({ title: x.name, url: x.url, snippet: x.description, publishedAt: x.datePublished });
      results = normalize([...web.map(toWeb), ...news.map(toNews)], { max, lang: ws.language, freshnessDays: ws.freshnessDays, includes: ws.includeDomains, excludes: ws.excludeDomains });
    } else {
      results = mockResults(query, max);
    }
  } catch (e: any) {
    const mode = (ws.on429 ?? "fallback").toLowerCase();
    if (e?.message === "RATE_LIMITED_FALLBACK" || mode === "fallback") {
      results = ws.providerFallback === "mock" ? mockResults(query, max) : [];
    } else {
      console.warn("webSearch provider error:", e?.message || e);
      results = mockResults(query, max);
    }
  }

  try {
    fs.writeFileSync(file, JSON.stringify({ _cachedAt: nowISO(), results }, null, 2), "utf8");
  } catch {}
  return results;
}

function mockResults(query: string, max: number): WebResult[] {
  return Array.from({ length: max }, (_, i) => ({
    title: `[Mock] ${query} #${i + 1}`,
    url: `https://example.com/${encodeURIComponent(query)}/${i + 1}`,
    snippet: `Simulated result for "${query}"`,
    publishedAt: nowISO(),
    source: "example.com",
  }));
}
