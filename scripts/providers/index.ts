import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { stooqSeries } from "./stooq.js";
import { avSeriesSmartFRCached } from "./alpha-vantage.js";

function readYAML<T=any>(p: string, fb: T): T {
  try { if (fs.existsSync(p)) return yaml.load(fs.readFileSync(p, "utf8")) as T; } catch {}
  return fb;
}

export async function fetchSeriesFor(symbol: string): Promise<{ used: string, data: number[] }> {
  const cfg = readYAML<any>(path.join("config","portfolio.yml"), {});
  const src = (cfg.market?.source || "mixed").toLowerCase();

  const avCfg = cfg.providers?.alphaVantage || {};
  const keyEnv = avCfg.keyEnv || "ALPHA_VANTAGE_KEY";
  const key = process.env[keyEnv] || "";
  const cacheDir = avCfg.cache?.dir || "data/_cache/alpha";
  const ttlDays = Number(avCfg.cache?.ttlDays ?? 7);
  const outputSize = (avCfg.outputSize || "compact") as "compact"|"full";
  const minDelayMs = Number(avCfg.minDelayMs ?? 15000);

  const mapCfg = readYAML<any>(path.join("config","alpha-symbols.yml"), {});
  const pinned: Record<string,string> = mapCfg?.map || {};

  if (symbol.startsWith("^")) {
    const data = await stooqSeries(symbol);
    return { used: symbol, data };
  }

  if (src === "alphavantage" || src === "mixed") {
    if (!key) {
      console.warn("[AlphaVantage] No API key in env. Set ALPHA_VANTAGE_KEY or use .env.");
      return { used: symbol, data: [] };
    }
    const avSymbol = pinned[symbol.toUpperCase()] || symbol;  // 👈 utilise le map si dispo
    const out = await avSeriesSmartFRCached(avSymbol, key, outputSize, minDelayMs, cacheDir, ttlDays);
    if (out.data.length) return out;

    // fallback éventuel Stooq
    try {
      const data = await stooqSeries(symbol);
      if (data.length) return { used: symbol, data };
    } catch {}
    return out;
  }

  const data = await stooqSeries(symbol);
  return { used: symbol, data };
}
