import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { avSymbolSearch, avTimeSeriesDailyAdjusted } from "./providers/alpha-vantage.js";

function readYAML<T=any>(p: string, fb: T): T {
  try { if (fs.existsSync(p)) return yaml.load(fs.readFileSync(p, "utf8")) as T; } catch {}
  return fb;
}
function ensureDir(d: string) { fs.mkdirSync(d, { recursive: true }); }

async function main() {
  const key = process.env.ALPHA_VANTAGE_KEY || "";
  if (!key) { console.error("No ALPHA_VANTAGE_KEY in env/.env"); process.exit(1); }

  const cfg = readYAML<any>("config/portfolio.yml", {});
  const wanted: string[] = Array.isArray(cfg.symbols) ? cfg.symbols : [];
  if (!wanted.length) { console.error("No symbols in config/portfolio.yml"); process.exit(1); }

  ensureDir("data/_cache/alpha");
  const outLines: string[] = [];
  outLines.push("# Propositions de correspondance Alpha Vantage (à copier dans config/alpha-symbols.yml)");
  outLines.push("map:");

  for (const s of wanted) {
    const bare = String(s).toUpperCase().replace(/\.[A-Z]{2,3}$/,"");
    console.log(`🔎 ${s} (bare: ${bare}) …`);
    try {
      const matches = await avSymbolSearch(bare, key);
      const short = matches.slice(0,5).map(m => `${m.symbol} | ${m.region || ""} | ${m.currency || ""} | ${m.name || ""}`);
      fs.writeFileSync(path.join("data/_cache/alpha", `discover_${bare}.json`), JSON.stringify(matches, null, 2));
      console.log(short.join("\n") || "  (aucun match)");

      // Essaye le 1er match “France/Paris/EUR” si dispo, sinon le 1er
      const pick = matches.find(m => /france|paris/i.test(m.region||"") || /eur/i.test(m.currency||"")) || matches[0];
      if (pick?.symbol) {
        outLines.push(`  ${s}: "${pick.symbol}"`);
        // sanity check rapide : close series non vide ?
        try {
          const series = await avTimeSeriesDailyAdjusted(pick.symbol, key, "compact");
          console.log(series.length ? `  ✓ série ok (${series.length} pts) -> ${pick.symbol}` : "  ⚠ série vide");
        } catch (e:any) {
          console.log("  ⚠ erreur série:", e?.message || e);
        }
      } else {
        outLines.push(`  ${s}: ""  # A compléter manuellement`);
      }
      console.log("");
    } catch (e:any) {
      console.log("  ⚠ erreur search:", e?.message || e);
    }
  }

  fs.writeFileSync("data/_cache/alpha/discover_map.yml", outLines.join("\n"), "utf8");
  console.log("\n📄 Suggestions écrites dans data/_cache/alpha/discover_map.yml");
  console.log("➡️  Copie/colle les lignes 'map:' dans config/alpha-symbols.yml");
}

main().catch(e => { console.error(e); process.exit(1); });
