import fs from "node:fs";
import path from "node:path";
import https from "node:https";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = ""; res.on("data", c => data += c); res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

/* ---------------- Cache helpers ---------------- */
function ensureDir(d: string) { fs.mkdirSync(d, { recursive: true }); }
function isFresh(iso: string, ttlDays: number) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return false;
  const ageMs = Date.now() - t;
  return ageMs < ttlDays * 24 * 3600 * 1000;
}
function readCache<T=any>(file: string, ttlDays: number): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!j || !j._cachedAt || !isFresh(j._cachedAt, ttlDays)) return null;
    return j.data as T;
  } catch { return null; }
}
function writeCache(file: string, data: any) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ _cachedAt: new Date().toISOString(), data }, null, 2), "utf8");
}

/* ---------------- API primitives ---------------- */
export async function avTimeSeriesDailyAdjusted(symbol: string, key: string, outputSize: "full"|"compact" = "compact"): Promise<number[]> {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(symbol)}&outputsize=${outputSize}&apikey=${encodeURIComponent(key)}`;
  const text = await httpGet(url);
  const json = JSON.parse(text);

  if (json["Note"] || json["Information"]) {
    throw new Error(json["Note"] || json["Information"]); // rate limit / guidance
  }
  const ts = json["Time Series (Daily)"];
  if (!ts || typeof ts !== "object") return [];

  const dates = Object.keys(ts).sort(); // asc
  const closes = dates.map(d => Number(ts[d]["5. adjusted close"] ?? ts[d]["4. close"])).filter(Number.isFinite);
  if (!closes.length) return [];
  const base = closes[0] || 1;
  return closes.map(x => (x / base) * 100);
}

export type AVSearchMatch = { symbol: string; name?: string; region?: string; currency?: string };

export async function avSymbolSearch(keyword: string, key: string): Promise<AVSearchMatch[]> {
  const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(keyword)}&apikey=${encodeURIComponent(key)}`;
  const text = await httpGet(url);
  const json = JSON.parse(text);
  const arr = Array.isArray(json?.bestMatches) ? json.bestMatches : [];
  return arr.map((m:any) => ({
    symbol: m["1. symbol"],
    name: m["2. name"],
    region: m["4. region"],
    currency: m["8. currency"]
  }));
}

/* ---------------- Smart FR + cache ---------------- */
/**
 * Retourne { used, data } pour un symbole FR (ex: MC.PA) en respectant:
 *  - cache disque (series + search)
 *  - retries avec minDelayMs pour rester sous le quota
 *  - heuristique Paris (region France/Paris / currency EUR)
 */
export async function avSeriesSmartFRCached(
  orig: string,
  key: string,
  outputSize: "full"|"compact",
  minDelayMs: number,
  cacheDir: string,
  ttlDays: number
): Promise<{ used: string, data: number[] }> {

  ensureDir(cacheDir);
  const seriesFile = path.join(cacheDir, `series_${orig.replace(/[^A-Z0-9^.-]/gi,'_')}_${outputSize}.json`);
  const cached = readCache<number[]>(seriesFile, ttlDays);
  if (cached && cached.length) return { used: orig, data: cached };

  const tried: string[] = [];
  const pushTry = (s:string) => { if (!tried.includes(s)) tried.push(s); };

  const upper = orig.toUpperCase();
  const bare  = upper.replace(/\.[A-Z]{2,3}$/, ""); // retire suffixe éventuel .PA/.EU…

  // 1) tentatives directes
  pushTry(upper); // MC.PA
  pushTry(bare);  // MC

  for (const cand of tried) {
    try {
      const data = await avTimeSeriesDailyAdjusted(cand, key, outputSize);
      if (data.length) { writeCache(seriesFile, data); return { used: cand, data }; }
    } catch (e:any) {
      if (/frequency.*per minute|Thank you for using/i.test(e?.message||"")) await sleep(minDelayMs);
    }
  }

  // 2) SYMBOL_SEARCH (cache aussi)
  const searchFile = path.join(cacheDir, `search_${bare}.json`);
  let matches = readCache<AVSearchMatch[]>(searchFile, ttlDays);
  if (!matches) {
    matches = await avSymbolSearch(bare, key);
    writeCache(searchFile, matches);
    // quota friendly
    await sleep(minDelayMs);
  }

  const pick = matches.find(m =>
    /france|paris/i.test(m.region||"") || /eur/i.test(m.currency||"")
  ) || matches[0];

  if (pick?.symbol) {
    try {
      const data = await avTimeSeriesDailyAdjusted(pick.symbol, key, outputSize);
      if (data.length) { writeCache(seriesFile, data); return { used: pick.symbol, data }; }
    } catch (e:any) {
      if (/frequency.*per minute|Thank you for using/i.test(e?.message||"")) await sleep(minDelayMs);
    }
  }

  // 3) Dernier essai “EPA:SYMBOL”
  const epa = `EPA:${bare}`;
  try {
    const data = await avTimeSeriesDailyAdjusted(epa, key, outputSize);
    if (data.length) { writeCache(seriesFile, data); return { used: epa, data }; }
  } catch {}

  // échec → mémoriser échec court pour éviter spam (écrit un tableau vide avec _cachedAt)
  writeCache(seriesFile, []);
  return { used: orig, data: [] };
}
