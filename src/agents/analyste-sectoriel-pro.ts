// src/agents/analyste-sectoriel-pro.ts
import type { Agent } from "../core/types.js";
import { fetchDailyCloses, estimateVolatility } from "../core/finance.js";

import { loadConfig } from "../core/config.js";
const config = loadConfig();
const UNIVERSE: Record<string, string[]> = Object.fromEntries(
  config.sectors.map(s => [s.name, s.symbols])
);

type SymbolMetrics = {
  symbol: string;
  last?: number;
  chg1d?: number;   // % vs J-1
  chg5d?: number;   // % vs J-5
  chg20d?: number;  // % vs J-20
  vol20?: number;   // écart-type des rendements journaliers (20)
  momentum20?: number; // (dernier - premier) / premier (20j)
  ok: boolean;
  error?: string;
};

export const AnalysteSectorielPro: Agent<{ sector: string }, {
  sector: string;
  asOf: string;
  symbols: SymbolMetrics[];
  aggregates: {
    avgChg1d?: number;
    avgChg5d?: number;
    avgVol20?: number;
  }
}> = {
  name: "AS-Pro",
  handles: ["as.pro"],
  async handle({ sector }) {
    const now = new Date().toISOString();
    const symbols = UNIVERSE[sector] ?? [];
    const out: SymbolMetrics[] = [];

    for (const sym of symbols) {
      try {
        const series = await fetchDailyCloses(sym, "1mo");
        const closes = series.points.map(p => p.close).filter(Number.isFinite);
        const n = closes.length;
        if (n < 6) throw new Error("insufficient data");

        const last = closes[n - 1];
        const getPct = (k: number) =>
          n > k ? ((last - closes[n - 1 - k]) / closes[n - 1 - k]) * 100 : undefined;

        const vol20 = estimateVolatility(series.points, 20); // ~écart-type des retours
        const base20 = n >= 20 ? closes[n - 20] : closes[0];
        const momentum20 = base20 ? (last - base20) / base20 : undefined;

        out.push({
          symbol: sym,
          last,
          chg1d: getPct(1),
          chg5d: getPct(5),
          chg20d: getPct(20),
          vol20,
          momentum20,
          ok: true,
        });
      } catch (e: any) {
        out.push({ symbol: sym, ok: false, error: String(e?.message || e) });
      }
    }

    const ok = out.filter(x => x.ok);
    const avg = (arr: (number | undefined)[]) => {
      const v = arr.filter((x): x is number => Number.isFinite(x as number));
      if (!v.length) return undefined;
      return v.reduce((a, b) => a + b, 0) / v.length;
    };

    return {
      sector,
      asOf: now,
      symbols: out,
      aggregates: {
        avgChg1d: avg(ok.map(x => x.chg1d)),
        avgChg5d: avg(ok.map(x => x.chg5d)),
        avgVol20: avg(ok.map(x => x.vol20)),
      },
    };
  },
};
