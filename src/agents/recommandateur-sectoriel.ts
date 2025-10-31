import type { Agent } from "../core/types.js";
import fs from "node:fs";
import path from "node:path";
import { getLatestChangePct } from "../core/finance.js";

/**
 * Score risque-ajusté basique:
 *   score = w5 * chg5d  +  w20 * chg20d  -  λ * vol20
 * Alternative (souvent plus stable): score = chg5d / (vol20 + ε)
 * On expose les deux; on choisit la seconde par défaut.
 */
import { loadConfig } from "../core/config.js";
const cfg = loadConfig();

const UNIVERSE: Record<string, string[]> = Object.fromEntries(
  cfg.sectors.map(s => [s.name, s.symbols])
);

const WEIGHTS = cfg.scoring;

type SectorAnalysis = {
  symbols: Array<{
    symbol: string;
    chg1d?: number; chg5d?: number; chg20d?: number;
    vol20?: number; momentum20?: number;
    last?: number;
    ok: boolean; error?: string;
  }>;
};

function loadSector(sector: string): SectorAnalysis | null {
  const p = path.join("data", "sectors", `${sector}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function scorePick(x: any) {
  const ch5 = Number.isFinite(x.chg5d) ? x.chg5d : 0;
  const ch20 = Number.isFinite(x.chg20d) ? x.chg20d : 0;
  const vol = Number.isFinite(x.vol20) ? x.vol20 : 0;

  if (WEIGHTS.useRatio) {
    return ch5 / (Math.abs(vol) + WEIGHTS.eps); // ratio simple, neutre au signe vol
  }
  return WEIGHTS.w5 * ch5 + WEIGHTS.w20 * ch20 - WEIGHTS.lambda * vol;
}

export const RecommandateurSectoriel: Agent<{ sector: string }, { topN: any[] }> = {
  name: "RS",
  handles: ["rs.topn"],
  async handle({ sector }) {
    // 1) On essaie d’utiliser l’analyse “pro”
    const analysis = loadSector(sector);
    if (analysis?.symbols?.length) {
      const ranked = analysis.symbols
        .filter(s => s.ok)
        .map(s => ({
          symbol: s.symbol,
          last: s.last,
          chg5d: s.chg5d,
          chg20d: s.chg20d,
          vol20: s.vol20,
          score: scorePick(s)
        }))
        .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
        .slice(0, 2);

      return { topN: ranked };
    }

    // 2) Fallback: si pas d’analyse, on retourne à l’ancien comportement (variation 1j)
    const symbols = UNIVERSE[sector] ?? [];
    const results: any[] = [];
    for (const s of symbols) {
      try {
        const r = await getLatestChangePct(s);
        results.push({ symbol: r.symbol, last: r.last, change: r.changePct, score: r.changePct });
      } catch (e) {
        results.push({ symbol: s, error: String(e) });
      }
    }
    const sorted = results
      .filter(r => r.score !== undefined)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    return { topN: sorted };
  }
};
