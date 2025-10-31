import type { Agent } from "../core/types.js";
import { getLatestChangePct } from "../core/finance.js";

const UNIVERSE: Record<string, string[]> = {
  Technology: ["AAPL", "MSFT", "NVDA"],
  Healthcare: ["JNJ", "PFE", "UNH"],
  Energy: ["XOM", "CVX", "BP"]
};

export const RecommandateurSectoriel: Agent<{ sector: string }, { topN: any[] }> = {
  name: "RS",
  handles: ["rs.topn"],
  async handle({ sector }) {
    const symbols = UNIVERSE[sector] ?? [];
    const results: any[] = [];
    for (const s of symbols) {
      try {
        const r = await getLatestChangePct(s);
        results.push({ symbol: r.symbol, last: r.last, change: r.changePct });
      } catch (e) {
        results.push({ symbol: s, error: String(e) });
      }
    }
    const sorted = results.filter(r => r.change !== undefined).sort((a, b) => b.change - a.change).slice(0, 2);
    return { topN: sorted };
  }
};