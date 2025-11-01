// scripts/cache-series.ts
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fetchSeriesFor } from "./providers/index.js";

function readJSON<T=any>(p: string, fb: T): T {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
  return fb;
}
function readYAML<T=any>(p: string, fb: T): T {
  try { if (fs.existsSync(p)) return yaml.load(fs.readFileSync(p, "utf8")) as T; } catch {}
  return fb;
}
function ensureDir(d: string) { fs.mkdirSync(d, { recursive: true }); }

async function main() {
  ensureDir("data");

  const cfg = readYAML<any>(path.join("config","portfolio.yml"), {});
  const defaultSuffix = cfg.market?.defaultSuffix || ".PA";
  const benchmark = cfg.market?.benchmark || "^CAC";

  // Construire l'univers à scraper (target + config.symbols + data/sectors/* + benchmark)
  const set = new Set<string>();
  const target = readJSON<any[]>(path.join("data","portfolio.target.json"), []);
  for (const t of target) if (t?.symbol) set.add(String(t.symbol).toUpperCase());
  if (Array.isArray(cfg.symbols)) for (const s of cfg.symbols) set.add(String(s).toUpperCase());
  const sectorsDir = path.join("data","sectors");
  if (fs.existsSync(sectorsDir)) {
    for (const f of fs.readdirSync(sectorsDir).filter(x=>x.endsWith(".json"))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(sectorsDir,f),"utf8"));
        for (const it of (j?.symbols||[])) set.add(String(it.symbol||it).toUpperCase());
      } catch {}
    }
  }
  set.add(benchmark);

  const syms = Array.from(set);
  console.log(`📈 Fetching price series (provider=mixed)…`);
  console.log("Symbols:", syms.join(", "));

  for (const sym of syms) {
    // normaliser le symbole d’entrée : s’il n’a pas de suffixe et n’est pas un indice, ajouter celui par défaut
    let input = sym;
    if (!input.startsWith("^") && !/\.[A-Z]{2,3}$/.test(input)) input = input + defaultSuffix.toUpperCase();

    try {
      const { used, data } = await fetchSeriesFor(input);
      if (data.length) {
        fs.writeFileSync(path.join("data", `series_${sym}.json`), JSON.stringify(data), "utf8");
        console.log(`✓ ${sym} ← ${used} (${data.length} pts)`);
      } else {
        console.warn(`⚠ No data for ${sym}`);
      }
    } catch (e:any) {
      console.warn(`⚠ Error ${sym}:`, e?.message || e);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
