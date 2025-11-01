import fs from "node:fs";
import path from "node:path";
import https from "node:https";

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

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, r2 => {
          let data = ""; r2.on("data", c => data += c); r2.on("end", () => resolve(data));
        }).on("error", reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = ""; res.on("data", c => data += c); res.on("end", () => resolve(data));
    });
    req.on("error", reject);
  });
}

async function tryYahooSeries(
  symbol: string,
  opts: { range: string; interval: string }
): Promise<number[]> {
  const { range, interval } = opts;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&events=div,splits`;

  try {
    const text = await httpGet(url);
    const json = JSON.parse(text);
    const rc = json?.chart?.result?.[0];
    if (!rc) return [];
    const adj = rc?.indicators?.adjclose?.[0]?.adjclose;
    const close = rc?.indicators?.quote?.[0]?.close;
    const arr = (Array.isArray(adj) && adj.some(v=>v!=null)) ? adj : close;
    const values = arr?.filter((x:any)=>typeof x==="number" && Number.isFinite(x)) ?? [];
    if (!values.length) return [];
    const base = values[0] || 1;
    return values.map((x:number)=>(x/base)*100);
  } catch (e:any) {
    if (String(e.message||"").includes("404")) return [];
    throw e;
  }
}

export async function yahooSeries(
  symbol: string,
  opts?: { range?: string; interval?: string; cacheDir?: string; ttlDays?: number }
): Promise<number[]> {
  const range = opts?.range || "10y";
  const interval = opts?.interval || "1d";
  const cacheDir = opts?.cacheDir || "data/_cache/yahoo";
  const ttlDays = Number(opts?.ttlDays ?? 7);

  const cacheFile = path.join(
    cacheDir,
    `series_${symbol.replace(/[^A-Z0-9^.-]/gi,'_')}_${range}_${interval}.json`
  );
  const cached = readCache<number[]>(cacheFile, ttlDays);
  if (cached && cached.length) return cached;

  // 🔁 fallback automatique
  const candidates = [symbol];
  if (/\.PA$/i.test(symbol)) {
    candidates.push(symbol.replace(/\.PA$/i, ".MI")); // ex: STM.MI
    candidates.push(symbol.replace(/\.PA$/i, ""));    // ex: STM
  }

  for (const cand of candidates) {
    const data = await tryYahooSeries(cand, { range, interval });
    if (data.length) {
      writeCache(cacheFile, data);
      if (cand !== symbol) console.log(`↪ fallback ${symbol} → ${cand}`);
      return data;
    }
  }

  writeCache(cacheFile, []); // mémorise échec vide pour éviter de retaper
  return [];
}
