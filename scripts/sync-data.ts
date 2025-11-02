import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fetchSeriesFor } from "./providers/index.js";

function readYAML<T=any>(p: string, fb: T): T {
  try { if (fs.existsSync(p)) return yaml.load(fs.readFileSync(p, "utf8")) as T; } catch {}
  return fb;
}

function ensureDir(d: string) { fs.mkdirSync(d, { recursive: true }); }

async function main() {
  const cfg = readYAML<any>("config/portfolio.yml", {});
  const symbols: string[] = cfg.symbols || [];
  if (!symbols.length) {
    console.error("No symbols found in config/portfolio.yml");
    process.exit(1);
  }

  const cacheRoot = "data/_cache";
  ensureDir(cacheRoot);

  console.log("🔄 Syncing price data for symbols:");
  console.log(symbols.join(", "));

  const updated: string[] = [];
  const failed: string[] = [];

  for (const s of symbols) {
    try {
      const { used, data } = await fetchSeriesFor(s);
      if (!data.length) {
        console.log(`⚠️  ${s} → ${used} : no data`);
        failed.push(s);
      } else {
        console.log(`✓ ${s} ← ${used} (${data.length} pts)`);
        updated.push(s);
      }
    } catch (e: any) {
      console.log(`❌ ${s}: ${e.message || e}`);
      failed.push(s);
    }
  }

  console.log("\n📊 Résumé:");
  console.log(`  ✓ ${updated.length} mises à jour`);
  console.log(`  ⚠️ ${failed.length} erreurs`);
  if (failed.length) console.log("  ->", failed.join(", "));
  console.log("\n💡 Les données sont maintenant synchronisées dans data/_cache/");
}

main();
