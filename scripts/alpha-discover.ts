// scripts/alpha-discover.ts
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

const NAME_HINTS: Record<string,string[]> = {
  "MC.PA": ["LVMH", "Moet Hennessy Louis Vuitton", "LVMH Paris"],
  "OR.PA": ["L'Oreal", "LOREAL", "L OREAL", "LOREAL Paris"],
  "RMS.PA":["Hermes", "Hermès", "Hermes International"],
  "SAN.PA":["Sanofi", "Sanofi Aventis"],
  "AI.PA": ["Air Liquide"],
  "TTE.PA":["TotalEnergies", "Total Energies", "Total"],
  "AIR.PA":["Airbus"],
  "SGO.PA":["Saint Gobain", "Compagnie de Saint-Gobain"],
  "BNP.PA":["BNP Paribas"],
  "ACA.PA":["Credit Agricole", "Crédit Agricole"],
  "GLE.PA":["Societe Generale", "Société Générale"],
  "CAP.PA":["Capgemini"],
  "ORA.PA":["Orange", "France Telecom", "France Télécom"],
  "STM.PA":["STMicroelectronics", "STM Microelectronics"]
};

function keywordsForSymbol(sym: string): string[] {
  const bare = sym.toUpperCase().replace(/\.[A-Z]{2,3}$/,""); // MC.PA -> MC
  const hints = NAME_HINTS[sym.toUpperCase()] || [];
  const uniq = (arr: string[]) => Array.from(new Set(arr.map(s => s.trim()).filter(Boolean)));
  return uniq([
    bare,
    `${bare}.PAR`,
    sym.toUpperCase(),        // MC.PA
    `${bare} Paris`,
    `${bare} EPA`,
    ...hints,
  ]);
}

async function tryOneKeyword(k: string, key: string) {
  const res = await avSymbolSearch(k, key);
  return res;
}

async function main() {
  const key = process.env.ALPHA_VANTAGE_KEY || "";
  if (!key) {
    console.error("❌ No ALPHA_VANTAGE_KEY in env/.env");
    process.exit(1);
  }
  const cfg = readYAML<any>("config/portfolio.yml", {});
  const wanted: string[] = Array.isArray(cfg.symbols) ? cfg.symbols : [];
  if (!wanted.length) {
    console.error("❌ No symbols in config/portfolio.yml");
    process.exit(1);
  }

  ensureDir("data/_cache/alpha");
  const outLines: string[] = [];
  outLines.push("# Propositions de correspondance Alpha Vantage");
  outLines.push("map:");

  for (const s of wanted) {
    const K = keywordsForSymbol(s);
    let pick: any = null;
    let pickedFrom = "";

    console.log(`\n🔎 ${s} — essais: ${K.join(" | ")}`);
    for (const kw of K) {
      try {
        const matches = await tryOneKeyword(kw, key);
        const short = matches.slice(0,5).map(m => `${m.symbol} | ${m.region || ""} | ${m.currency || ""} | ${m.name || ""}`);
        console.log(`  • ${kw}:`);
        if (short.length) {
          console.log("    " + short.join("\n    "));
          const best = matches.find(m => /france|paris/i.test(m.region||"") || /eur/i.test(m.currency||"")) || matches[0];
          if (best) { pick = best; pickedFrom = kw; break; }
        } else {
          console.log("    (aucun match)");
        }
      } catch (e:any) {
        console.log(`    ⚠ erreur (${kw}):`, e?.message || e);
      }
    }

    if (pick?.symbol) {
      // sanity check série
      try {
        const series = await avTimeSeriesDailyAdjusted(pick.symbol, key, "compact");
        console.log(series.length ? `  ✓ série OK (${pick.symbol})` : `  ⚠ série vide (${pick.symbol})`);
      } catch (e:any) {
        console.log(`  ⚠ série erreur (${pick.symbol}):`, e?.message || e);
      }
      outLines.push(`  ${s}: "${pick.symbol}"  # via "${pickedFrom}"`);
    } else {
      outLines.push(`  ${s}: ""  # A compléter manuellement (aucun match)`);
    }
  }

  const outFile = "data/_cache/alpha/discover_map.yml";
  fs.writeFileSync(outFile, outLines.join("\n"), "utf8");
  console.log(`\n📄 Suggestions écrites dans ${outFile}\n➡️  Copie/colle 'map:' dans config/alpha-symbols.yml`);
}

main().catch(e => { console.error(e); process.exit(1); });
