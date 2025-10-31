import { appendJSONL } from "../core/io.js";
import { AnalysteSectoriel } from "../agents/analyste-sectoriel.js";
import { RecommandateurSectoriel } from "../agents/recommandateur-sectoriel.js";
import { StrategistePortefeuille } from "../agents/strategiste-portefeuille.js";
import { RiskManager } from "../agents/risk-manager.js";
import { AnalysteSectorielPro } from "../agents/analyste-sectoriel-pro.js"; // NEW
import { AnalysteSecteurQuali } from "../agents/analyste-secteur-quali.js";
import { ChercheurEntreprise } from "../agents/chercheur-entreprise.js";
import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "../core/config.js";
const cfg = loadConfig();
const SECTORS = cfg.sectors.map(s => s.name);
const CONSTRAINTS = cfg.constraints;

export async function runWeekly() {
  const summary: any[] = [];
  const sectorsTop: any[] = [];

  // Assure l'arborescence des analyses
  fs.mkdirSync(path.join("data", "sectors"), { recursive: true }); // NEW

  for (const sector of SECTORS) {
    // Analyse "simple" existante (historique du pipeline)
    const as = await AnalysteSectoriel.handle({ sector });

    // Analyse "pro" détaillée (nouvel agent)
    const asp = await AnalysteSectorielPro.handle({ sector }); // NEW
    fs.writeFileSync( // NEW
      path.join("data", "sectors", `${sector}.json`),
      JSON.stringify(asp, null, 2),
      "utf8"
    );

    const rs = await RecommandateurSectoriel.handle({ sector });
    appendJSONL("recos.jsonl", { sector, as, asp, rs }); // inclut asp

    const picks = (rs.topN || []).map((t: any) => ({ symbol: t.symbol, change: t.change }));
    sectorsTop.push({ sector, picks });
    summary.push({ sector, top: picks.map((p: any) => `${p.symbol} (${(p.change ?? 0).toFixed(2)}%)`) });
  }

  // Analyse qualitative sectorielle (mock web)
  await AnalysteSecteurQuali.handle({ sector });

  // Recherche entreprises principales du secteur
  const companies = asp.symbols.map(x => x.symbol);
  for (const sym of companies) {
    await ChercheurEntreprise.handle({ symbol: sym });
  }

  const alloc = await StrategistePortefeuille.handle({
    sectors: sectorsTop,
    constraints: { maxLine: CONSTRAINTS.maxLine, maxSector: CONSTRAINTS.maxSector }
  });

  const risk = await RiskManager.handle({
    target: alloc.target,
    limits: { maxLine: CONSTRAINTS.maxLine, maxSector: CONSTRAINTS.maxSector }
  });

  const portfolio = {
    asOf: new Date().toISOString(),
    target: alloc.target,
    riskStatus: risk.status,
    riskBreaches: risk.breaches
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/weekly-summary.json", JSON.stringify({ date: portfolio.asOf, summary }, null, 2));
  fs.writeFileSync("data/portfolio.target.json", JSON.stringify(portfolio, null, 2));
  appendJSONL("exec.log.jsonl", { action: "weekly.completed" });

  console.log("✅ Weekly report generated. Risk:", risk.status, risk.breaches);
}
