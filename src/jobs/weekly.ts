import fs from "node:fs";
import path from "node:path";

import { AnalysteSectoriel } from "../agents/analyste-sectoriel.js";
import { AnalysteSectorielPro } from "../agents/analyste-sectoriel-pro.js";
import { AnalysteSecteurQuali } from "../agents/analyste-secteur-quali.js";
import { AnalyseurQuali } from "../agents/analyseur-quali.js";
import { ChercheurEntreprise } from "../agents/chercheur-entreprise.js";
import { RecommandateurSectoriel } from "../agents/recommandateur-sectoriel.js";
import { StrategistePortefeuille } from "../agents/strategiste-portefeuille.js";
import { RiskManager } from "../agents/risk-manager.js";

import { loadConfig } from "../core/config.js";
import { appendJSONL } from "../core/io.js";

export async function runWeekly() {
  console.log("🏁 Starting weekly cycle...");

  const cfg = loadConfig();
  const SECTORS = cfg.sectors.map(s => s.name);
  const CONSTRAINTS = cfg.constraints;

  fs.mkdirSync("data", { recursive: true });
  fs.mkdirSync(path.join("data", "sectors"), { recursive: true });
  fs.mkdirSync(path.join("data", "research", "sectors"), { recursive: true });
  fs.mkdirSync(path.join("data", "research", "companies"), { recursive: true });

  const summary: any[] = [];
  const sectorsTop: any[] = [];

  // === Boucle principale par secteur ===
  for (const sector of SECTORS) {
    console.log(`\n📈 Analyse du secteur ${sector}...`);

    // Analyse sectorielle simple (baseline)
    const as = await AnalysteSectoriel.handle({ sector });

    // Analyse sectorielle pro (quant)
    const asp = await AnalysteSectorielPro.handle({ sector });
    fs.writeFileSync(
      path.join("data", "sectors", `${sector}.json`),
      JSON.stringify(asp, null, 2),
      "utf8"
    );

    // Analyse qualitative sectorielle (mock web)
    await AnalysteSecteurQuali.handle({ sector });
    await AnalyseurQuali.handle({ sector }); // ← AJOUT

    // Recherche des entreprises principales du secteur
    const companies = (asp.symbols || []).map((x: any) => x.symbol);
    for (const sym of companies) {
      await ChercheurEntreprise.handle({ symbol: sym });
    }

    // Recommandations sur le secteur
    const rs = await RecommandateurSectoriel.handle({ sector });
    appendJSONL("recos.jsonl", { sector, as, asp, rs });

    // Sélection des picks top N
    const picks = (rs.topN || []).map((t: any) => ({
      symbol: t.symbol,
      change: t.change,
      score: t.score
    }));
    sectorsTop.push({ sector, picks });

    summary.push({
      sector,
      top: picks.map((p: any) =>
        `${p.symbol}${Number.isFinite(p.score) ? ` (score ${p.score.toFixed(2)})` : ""}`
      )
    });
  }

  // === Allocation portefeuille ===
  console.log("\n🧮 Allocation du portefeuille...");
  const { target } = await StrategistePortefeuille.handle({
    sectors: sectorsTop,
    constraints: CONSTRAINTS
  });

  fs.writeFileSync("data/portfolio.target.json", JSON.stringify(target, null, 2), "utf8");

  // === Gestion du risque ===
  console.log("🛡️  Analyse du risque...");
  const risk = await RiskManager.handle({ target });
  fs.writeFileSync("data/portfolio.risk.json", JSON.stringify(risk, null, 2), "utf8");

  // === Résumé final ===
  const report = {
    asOf: new Date().toISOString(),
    sectors: summary,
    risk,
    target
  };
  fs.writeFileSync("data/weekly-summary.json", JSON.stringify(report, null, 2), "utf8");

  console.log("✅ Weekly report generated.");
  return report;
}
