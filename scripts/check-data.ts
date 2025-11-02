import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

function readYAML<T=any>(p: string, fb: T): T {
  try { if (fs.existsSync(p)) return yaml.load(fs.readFileSync(p, "utf8")) as T; } catch {}
  return fb;
}

function listSeriesFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.startsWith("series_") && f.endsWith(".json"));
}

function readSeries(file: string): number[] {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(j.data) ? j.data : [];
  } catch { return []; }
}

function countPoints(file: string): number {
  const data = readSeries(file);
  return data.length;
}

async function main() {
  const cfg = readYAML<any>("config/portfolio.yml", {});
  const yahooDir = cfg.providers?.yahoo?.cache?.dir || "data/_cache/yahoo";
  const stooqDir = "data/_cache/stooq";

  const symbols: string[] = cfg.symbols || [];
  if (!symbols.length) {
    console.error("No symbols in config/portfolio.yml");
    process.exit(1);
  }

  console.log("🔍 Checking cached data...");
  const missing: string[] = [];
  const short: string[] = [];
  const ok: string[] = [];

  for (const s of symbols) {
    const pattern = `series_${s.replace(/[^A-Z0-9^.-]/gi,'_')}`;
    const dirs = [yahooDir, stooqDir];
    let found = false;
    for (const d of dirs) {
      const files = listSeriesFiles(d);
      const f = files.find(x => x.includes(pattern));
      if (f) {
        found = true;
        const full = path.join(d, f);
        const pts = countPoints(full);
        if (pts < 50) short.push(`${s} (${pts})`);
        else ok.push(`${s} (${pts})`);
        break;
      }
    }
    if (!found) missing.push(s);
  }

  console.log(`\n✅ OK: ${ok.length}`);
  if (ok.length) console.log(" ", ok.join(", "));
  console.log(`\n⚠️  Courtes (<50 pts): ${short.length}`);
  if (short.length) console.log(" ", short.join(", "));
  console.log(`\n❌ Manquantes: ${missing.length}`);
  if (missing.length) console.log(" ", missing.join(", "));

  if (missing.length) {
    console.log("\n💡 Suggestion: relance `npm run report:cache` pour ces symboles manquants.");
  }
}

main();
