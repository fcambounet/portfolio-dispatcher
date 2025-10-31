// scripts/cache-series.ts
import fs from "node:fs";
import path from "node:path";
import { fetchDailyCloses } from "../src/core/finance.js";

// symboles utilisés dans l'allocation + picks
const portfolio = JSON.parse(fs.readFileSync("data/portfolio.target.json","utf8"));
const weekly = JSON.parse(fs.readFileSync("data/weekly-summary.json","utf8"));

const symbols = new Set<string>();
for (const t of (portfolio.target||[])) symbols.add(t.symbol);
for (const s of (weekly.summary||[])) {
  for (const line of (s.top||[])) {
    const sym = (line.match(/^([A-Z.\-]+)/)?.[1]) || "";
    if (sym) symbols.add(sym);
  }
}

fs.mkdirSync("data", { recursive: true });

const run = async () => {
  for (const sym of symbols) {
    try {
      const series = await fetchDailyCloses(sym, "1mo");
      const closes = series.points.map((p:any)=>p.close).filter((x:number)=>Number.isFinite(x));
      fs.writeFileSync(path.join("data", `series_${sym}.json`), JSON.stringify(closes));
      console.log("cached", sym, closes.length);
    } catch (e:any) {
      console.warn("skip", sym, e.message);
    }
  }
};
run();
