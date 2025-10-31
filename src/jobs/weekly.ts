import { appendJSONL } from "../core/io.js";
import { AnalysteSectoriel } from "../agents/analyste-sectoriel.js";
import { RecommandateurSectoriel } from "../agents/recommandateur-sectoriel.js";
import { StrategistePortefeuille } from "../agents/strategiste-portefeuille.js";
import { RiskManager } from "../agents/risk-manager.js";
import fs from "node:fs";

const SECTORS = ["Technology", "Healthcare", "Energy"];
const CONSTRAINTS = { maxLine: 0.05, maxSector: 0.20 };

export async function runWeekly() {
  const summary: any[] = [];
  const sectorsTop: any[] = [];

  for (const sector of SECTORS) {
    const as = await AnalysteSectoriel.handle({ sector });
    const rs = await RecommandateurSectoriel.handle({ sector });
    appendJSONL("recos.jsonl", { sector, as, rs });

    const picks = (rs.topN || []).map((t: any) => ({ symbol: t.symbol, change: t.change }));
    sectorsTop.push({ sector, picks });
    summary.push({ sector, top: picks.map((p: any) => `${p.symbol} (${(p.change ?? 0).toFixed(2)}%)`) });
  }

  const alloc = await StrategistePortefeuille.handle({ sectors: sectorsTop, constraints: { maxLine: CONSTRAINTS.maxLine, maxSector: CONSTRAINTS.maxSector } });
  const risk = await RiskManager.handle({ target: alloc.target, limits: { maxLine: CONSTRAINTS.maxLine, maxSector: CONSTRAINTS.maxSector } });

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