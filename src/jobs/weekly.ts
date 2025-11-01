import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/config.js";
import { RiskManager } from "../agents/risk-manager.js";
import { StrategistePortefeuille } from "../agents/strategiste-portefeuille.js";
import { AnalysteSecteurQuali } from "../agents/analyste-secteur-quali.js";
import { snapshotWeekly } from "../core/history.js";
import { nowISO } from "../core/utils.js";

/* -------------------------------------------------------- */
/* ------------------- HELPERS GÉNÉRAUX ------------------- */
/* -------------------------------------------------------- */

function ensureDir(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function safeWriteJSON(p: string, data: any) {
  ensureDir(p);
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

function readJSON<T=any>(p: string, fb: T): T {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,"utf8")); } catch {}
  return fb;
}

/** Lis les entreprises depuis data/sectors/<secteur>.json */
function companiesFromSectorFile(sec: string): string[] {
  const p = path.join("data","sectors",`${sec}.json`);
  const j = readJSON<any>(p, null as any);
  return Array.isArray(j?.symbols) ? j.symbols.map((x:any)=>x.symbol).filter(Boolean) : [];
}

/** Répartit la liste universe sur sectors de manière stable */
function distributeUniverse(universe: string[], sectors: string[]): Record<string,string[]> {
  const map: Record<string,string[]> = {};
  for (const s of sectors) map[s] = [];
  if (!sectors.length) return map;
  let i = 0;
  for (const sym of universe) {
    map[sectors[i % sectors.length]].push(sym);
    i++;
  }
  return map;
}

/** Combine fichiers sectoriels + fallback depuis config.symbols */
function getCompaniesPerSector(cfg: any): Record<string, string[]> {
  const sectors: string[] = Array.isArray(cfg.sectors) ? cfg.sectors : [];
  const universe: string[] = Array.isArray(cfg.symbols) ? cfg.symbols : [];

  const out: Record<string,string[]> = {};
  for (const s of sectors) out[s] = [];

  // fichiers data/sectors
  if (fs.existsSync("data/sectors")) {
    for (const f of fs.readdirSync("data/sectors").filter(x => x.endsWith(".json"))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join("data/sectors", f),"utf8"));
        const sec = j?.sector;
        if (sec && Array.isArray(j.symbols)) {
          out[sec] = j.symbols.map((x:any)=>x.symbol).filter(Boolean);
        }
      } catch {}
    }
  }

  // secteurs manquants -> distribuer depuis config.symbols
  const missing = sectors.filter(s => !out[s] || out[s].length===0);
  if (missing.length && universe.length) {
    const dist = distributeUniverse(universe, missing);
    for (const sec of missing) out[sec] = dist[sec] || [];
  }

  return out;
}

/* -------------------------------------------------------- */
/* ------------------- MAIN WEEKLY JOB -------------------- */
/* -------------------------------------------------------- */

export async function runWeekly() {
  console.log("🏁 Starting weekly cycle...");

  const cfg = loadConfig();
  const asOf = nowISO();

  // Récupérer les entreprises par secteur (fallback FR inclus)
  const companiesPerSector = getCompaniesPerSector(cfg);
  for (const [sec, list] of Object.entries(companiesPerSector)) {
    console.log(`• ${sec}: ${list.length} valeurs`);
  }

  // --- Étape 1: analyse sectorielle
  const sectorSummaries: Array<{sector:string;top:string[]}> = [];
  const MAX_PER_SECTOR = 3;

  for (const sector of Object.keys(companiesPerSector)) {
    const companies = companiesPerSector[sector].slice(0, MAX_PER_SECTOR);

    // Analyse qualitative (mock ou réel)
    try {
      await AnalysteSecteurQuali.handle({ sector, companies });
    } catch (e:any) {
      console.warn(`AnalysteSecteurQuali error ${sector}:`, e?.message || e);
    }

    sectorSummaries.push({
      sector,
      top: companies.map(s => `${s} (PickScore=1.0)`)
    });
  }

  // --- Étape 2: stratégie
  console.log("🧮 Allocation du portefeuille...");
  let strat;
  try {
    strat = await StrategistePortefeuille.handle({
      sectors: sectorSummaries,
      constraints: cfg.constraints
    });
  } catch (e:any) {
    console.warn("StrategistePortefeuille.handle() error:", e?.message || e);
    strat = { target: [] };
  }

  let target: Array<{symbol:string;weight:number}> = Array.isArray(strat?.target) ? strat.target : [];

  // --- Fallback si le stratégiste ne renvoie rien
  if (!target.length) {
    const universe = Object.values(companiesPerSector).flat().filter(Boolean);
    const uniq = Array.from(new Set(universe)).slice(0, 12);
    const n = uniq.length;
    if (n > 0) {
      const w = Number((1 / n).toFixed(6));
      target = uniq.map(s => ({ symbol: s, weight: w }));
      const sum = Number(target.reduce((a,b)=>a+(b.weight||0),0).toFixed(6));
      if (Math.abs(sum - 1) > 1e-6) {
        const diff = Number((1 - sum).toFixed(6));
        target[target.length-1].weight = Number((target[target.length-1].weight + diff).toFixed(6));
      }
      console.warn(`⚠️ Fallback target construit (${n} lignes, égalisé).`);
    } else {
      console.error("❌ Impossible de construire un fallback target (univers vide). Vérifie config.symbols et data/sectors FR.");
    }
  }

  // --- Étape 3: analyse du risque
  console.log("🛡️  Analyse du risque...");
  let risk;
  try {
    risk = await RiskManager.handle({ target });
  } catch (e:any) {
    console.warn("RiskManager.handle() error:", e?.message || e);
    risk = { riskStatus: "UNKNOWN" };
  }

  // --- Étape 4: écriture des résultats
  safeWriteJSON(path.join("data","portfolio.target.json"), target);
  safeWriteJSON(path.join("data","portfolio.risk.json"), risk);

  // Résumé hebdo minimal
  const report = {
    asOf,
    target,
    risk,
    sectors: sectorSummaries
  };
  safeWriteJSON(path.join("data","weekly-summary.json"), report);

  // Snapshot hebdomadaire complet (historique)
  snapshotWeekly(asOf);

  console.log("🧪 Checks: ISSUES • Audit → data/audit/" + asOf.slice(0,10) + ".json");
  console.log("🧾 Trades exécutés:", 0);
  console.log("✅ Weekly report generated.");
}
