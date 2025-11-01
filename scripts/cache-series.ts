// scripts/cache-series.ts
import fs from "node:fs";
import path from "node:path";
import https from "node:https";

function readJSON<T>(p: string, fb: T): T {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
  return fb;
}
function ensureDir(d: string) { fs.mkdirSync(d, { recursive: true }); }

function stooqSymbol(sym: string): string {
  // Stooq : AAPL.US, MSFT.US, NVDA.US, SPY.US, etc.
  // Si déjà suffixé, laisse tel quel.
  if (/\.US$/i.test(sym)) return sym.toLowerCase();
  return `${sym}.US`.toLowerCase();
}

function fetchCSV(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // suivre redirect
        https.get(res.headers.location, res2 => {
          let data = "";
          res2.on("data", c => (data += c));
          res2.on("end", () => resolve(data));
        }).on("error", reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

async function fetchStooqSeries(sym: string): Promise<number[]> {
  const s = stooqSymbol(sym);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`;
  const csv = await fetchCSV(url);
  // CSV: Date,Open,High,Low,Close,Volume
  const lines = csv.trim().split(/\r?\n/).slice(1);
  const closes = lines.map(l => Number(l.split(",")[4])).filter(x => Number.isFinite(x));
  if (!closes.length) return [];
  // normalise base 100 (optionnel)
  const base = closes[0] || 1;
  return closes.map(x => (x / base) * 100);
}

async function main() {
  ensureDir("data");

  // 1) Collecte des symboles à partir de la cible + benchmark
  const target = readJSON<any[]>(path.join("data","portfolio.target.json"), []);
  const set = new Set<string>(target.map(t => t.symbol).filter(Boolean));
  // benchmark par défaut : SPY
  set.add("SPY");

  const syms = Array.from(set);
  if (!syms.length) { console.log("No symbols to fetch."); return; }

  console.log("Fetching series for:", syms.join(", "));
  for (const sym of syms) {
    try {
      const arr = await fetchStooqSeries(sym);
      if (arr.length) {
        fs.writeFileSync(path.join("data", `series_${sym}.json`), JSON.stringify(arr), "utf8");
        console.log(`✓ ${sym} (${arr.length} pts)`);
      } else {
        console.warn(`⚠ No data for ${sym}`);
      }
    } catch (e: any) {
      console.warn(`⚠ Error ${sym}:`, e?.message || e);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
