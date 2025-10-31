import type { Agent } from "../core/types.js";

type Pick = { symbol: string; change: number };
type SectorTop = { sector: string; picks: Pick[] };

export const StrategistePortefeuille: Agent<{ sectors: SectorTop[], constraints: { maxLine: number; maxSector: number } }, { target: any[] }> = {
  name: "SP",
  handles: ["sp.allocate"],
  async handle({ sectors, constraints }) {
    const nSec = sectors.length || 1;
    const perSector = Math.min(1 / nSec, constraints.maxSector);
    const target: any[] = [];
    for (const s of sectors) {
      const n = s.picks.length || 1;
      const perLine = Math.min(perSector / n, constraints.maxLine);
      for (const p of s.picks) {
        target.push({ symbol: p.symbol, weight: Number(perLine.toFixed(4)), reason: `Top pick ${s.sector} change=${p.change?.toFixed?.(2) ?? "n/a"}%` });
      }
    }
    const sum = target.reduce((a, b) => a + b.weight, 0);
    if (sum > 1) target.forEach(t => t.weight = Number((t.weight / sum).toFixed(4)));
    return { target };
  }
};