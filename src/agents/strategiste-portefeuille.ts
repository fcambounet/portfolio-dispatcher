import type { Agent } from "../core/types.js";

type Pick = { symbol: string; change?: number; score?: number };
type SectorTop = { sector: string; picks: Pick[] };

export const StrategistePortefeuille: Agent<
  { sectors: SectorTop[], constraints: { maxLine: number; maxSector: number } },
  { target: any[] }
> = {
  name: "SP",
  handles: ["sp.allocate"],
  async handle({ sectors, constraints }) {
    // Poids par secteur égalisés (ou à affiner plus tard)
    const nSec = sectors.length || 1;
    const perSector = Math.min(1 / nSec, constraints.maxSector);

    const target: any[] = [];
    for (const s of sectors) {
      const picks = s.picks || [];

      // normalisation par score (fallback = égal)
      const scores = picks.map(p => Number.isFinite(p.score as number) ? (p.score as number) : 1);
      const sum = scores.reduce((a, b) => a + (isFinite(b) ? b : 0), 0) || picks.length || 1;

      for (let i = 0; i < picks.length; i++) {
        const frac = (scores[i] || 1) / sum;
        let w = perSector * frac;
        // borne max par ligne
        if (w > constraints.maxLine) w = constraints.maxLine;

        target.push({
          symbol: picks[i].symbol,
          weight: Number(w.toFixed(4)),
          reason: `Score=${(picks[i].score ?? 0).toFixed(3)}`
        });
      }
    }

    // Normalisation globale si > 100%
    const total = target.reduce((a, b) => a + b.weight, 0);
    if (total > 1) target.forEach(t => (t.weight = Number((t.weight / total).toFixed(4))));

    return { target };
  }
};
