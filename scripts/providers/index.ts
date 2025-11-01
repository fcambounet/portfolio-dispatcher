// en haut des imports
import yaml from "js-yaml";
import fs from "node:fs";
import path from "node:path";

// ... (fichier existant)

// ajoute ce helper si pas déjà présent
function readYAML<T=any>(p: string, fb: T): T {
  try { if (fs.existsSync(p)) return yaml.load(fs.readFileSync(p, "utf8")) as T; } catch {}
  return fb;
}

export async function fetchSeriesFor(symbol: string): Promise<{ used: string, data: number[] }> {
  const cfg = readYAML<any>(path.join("config","portfolio.yml"), {});
  const src = (cfg.market?.source || "mixed").toLowerCase();

  if (symbol.startsWith("^")) {
    const data = await stooqSeries(symbol);
    return { used: symbol, data };
  }

  if (src === "mixed" || src === "yahoo") {
    const ycfg = cfg.providers?.yahoo || {};

    // 🔹 NOUVEAU: alias Yahoo
    const ymap = readYAML<any>(path.join("config","yahoo-symbols.yml"), {});
    const aliasMap: Record<string,string> = ymap?.map || {};
    const sym = aliasMap[symbol.toUpperCase()] || symbol;

    const data = await yahooSeries(sym, {
      range: ycfg.range || "10y",
      interval: ycfg.interval || "1d",
      cacheDir: ycfg.cache?.dir || "data/_cache/yahoo",
      ttlDays: Number(ycfg.cache?.ttlDays ?? 7),
    });
    if (data.length) return { used: sym, data };
    return { used: sym, data: [] };
  }

  const data = await stooqSeries(symbol);
  return { used: symbol, data };
}
