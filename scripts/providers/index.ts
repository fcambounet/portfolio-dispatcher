// scripts/providers/index.ts
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { yahooSeries } from "./yahoo.js";
import { stooqSeries } from "./stooq.js";

/** Lecture YAML/JSON simple */
function readYAML<T = any>(p: string, fb: T): T {
  try {
    if (fs.existsSync(p)) return yaml.load(fs.readFileSync(p, "utf8")) as T;
  } catch {}
  return fb;
}

/** Orchestration : choisit la source selon le type de symbole */
export async function fetchSeriesFor(symbol: string): Promise<{ used: string; data: number[] }> {
  const cfg = readYAML<any>(path.join("config", "portfolio.yml"), {});
  const src = (cfg.market?.source || "mixed").toLowerCase();

  // 🔹 Indices → Stooq (ex: ^CAC)
  if (symbol.startsWith("^")) {
    const data = await stooqSeries(symbol);
    return { used: symbol, data };
  }

  // 🔹 Actions FR → Yahoo
  if (src === "mixed" || src === "yahoo") {
    const ycfg = cfg.providers?.yahoo || {};
    const data = await yahooSeries(symbol, {
      range: ycfg.range || "10y",
      interval: ycfg.interval || "1d",
      cacheDir: ycfg.cache?.dir || "data/_cache/yahoo",
      ttlDays: Number(ycfg.cache?.ttlDays ?? 7),
    });
    if (data.length) return { used: symbol, data };
    return { used: symbol, data: [] };
  }

  // 🔹 Fallback Stooq pur
  const data = await stooqSeries(symbol);
  return { used: symbol, data };
}
