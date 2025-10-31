import fs from "node:fs";
import path from "node:path";
import type { Agent } from "../core/types.js";

type Pick = { symbol: string; change?: number; score?: number };
type SectorTop = { sector: string; picks: Pick[] };
type Constraints = { maxLine: number; maxSector: number };

function loadSectorAgg(sector: string): { avgChg5d?: number; avgVol20?: number } | null {
  const p = path.join("data", "sectors", `${sector}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return j.aggregates || null;
  } catch {
    return null;
  }
}

export const StrategistePortefeuille: Agent<
  { sectors: SectorTop[]; constraints: Constraints },
  { target: any[] }
> = {
  name: "SP",
  handles: ["sp.allocate"],
  async handle({ sectors, constraints }) {
    const ε = 1e-4;

    // 🔹 1. Charger agrégats et calculer score sectoriel
    const sectorsWithScores = sectors.map(s => {
      const agg = loadSectorAgg(s.sector);
      const score =
        agg && agg.avgChg5d !== undefined && agg.avgVol20 !== undefined
          ? agg.avgChg5d / (Math.abs(agg.avgVol20) + ε)
          : 1; // fallback neutre
      return { ...s, sectorScore: score };
    });

    // 🔹 2. Normaliser les scores pour qu'ils fassent 1
    const totalScore = sectorsWithScores.reduce((a, b) => a + (b.sectorScore || 0), 0) || 1;
    const sectorsWeighted = sectorsWithScores.map(s => ({
      ...s,
      sectorWeight: (s.sectorScore || 0) / totalScore
    }));

    // 🔹 3. Créer les allocations internes
    const target: any[] = [];

    for (const s of sectorsWeighted) {
      const perSector = Math.min(s.sectorWeight, constraints.maxSector);
      const picks = s.picks || [];

      // normalisation par score (fallback = égal)
      const scores = picks.map(p => Number.isFinite(p.score as number) ? (p.score as number) : 1);
      const sum = scores.reduce((a, b) => a + (isFinite(b) ? b : 0), 0) || picks.length || 1;

      for (let i = 0; i < picks.length; i++) {
        const frac = (scores[i] || 1) / sum;
        let w = perSector * frac;
        if (w > constraints.maxLine) w = constraints.maxLine;

        target.push({
          symbol: picks[i].symbol,
          weight: Number(w.toFixed(4)),
          reason: `SectorScore=${s.sectorScore.toFixed(3)}; PickScore=${(picks[i].score ?? 0).toFixed(3)}`
        });
      }
    }

    // 🔹 4. Normalisation globale si > 100 %
    const total = target.reduce((a, b) => a + b.weight, 0);
    if (total > 1) target.forEach(t => (t.weight = Number((t.weight / total).toFixed(4))));

    return { target };
  }
};
