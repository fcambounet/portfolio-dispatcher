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
    const EPS = 1e-8;
    const ε = 1e-4;

    // 1) Score sectoriel (clampé à >= 0) ; fallback = 1 si manquant
    let rawSectorScores = sectors.map(s => {
      const agg = loadSectorAgg(s.sector);
      let score = 1; // neutre
      if (agg && Number.isFinite(agg.avgChg5d) && Number.isFinite(agg.avgVol20)) {
        score = (agg.avgChg5d as number) / (Math.abs(agg.avgVol20 as number) + ε);
      }
      if (!Number.isFinite(score)) score = 0;
      // clamp >= 0 (pas de poids négatifs)
      score = Math.max(0, score);
      return { sector: s.sector, picks: s.picks || [], score };
    });

    // si tous les scores sont 0, fallback égalitaire
    const sumSector = rawSectorScores.reduce((a, b) => a + b.score, 0);
    if (sumSector <= EPS) {
      rawSectorScores = rawSectorScores.map(s => ({ ...s, score: 1 }));
    }

    // normaliser secteur → poids sectoriel (<= maxSector)
    const sectorTotal = rawSectorScores.reduce((a, b) => a + b.score, 0) || 1;
    const sectorsWeighted = rawSectorScores.map(s => {
      const w = s.score / sectorTotal;
      return { ...s, sectorWeight: Math.min(w, constraints.maxSector) };
    });

    // 2) Pondération intra-secteur par scores (clampés >= 0), fallback égalitaire si somme = 0
    const target: any[] = [];
    for (const s of sectorsWeighted) {
      const pickScores = (s.picks || []).map(p => {
        let sc = Number.isFinite(p.score as number) ? (p.score as number) : 0;
        if (!Number.isFinite(sc)) sc = 0;
        return Math.max(0, sc); // clamp >= 0
      });
      let sumPick = pickScores.reduce((a, b) => a + b, 0);
      if (sumPick <= EPS) {
        // tout à 0 → égalitaire
        pickScores.fill(1);
        sumPick = pickScores.length || 1;
      }

      for (let i = 0; i < (s.picks || []).length; i++) {
        const frac = pickScores[i] / sumPick;
        let w = s.sectorWeight * frac;
        // cap ligne
        if (w > constraints.maxLine) w = constraints.maxLine;
        // clamp >= 0
        w = Math.max(0, w);

        target.push({
          symbol: s.picks[i].symbol,
          weight: Number(w.toFixed(4)),
          reason: `SectorScore=${s.score.toFixed(3)}; SectorW=${s.sectorWeight.toFixed(3)}; PickScore=${(s.picks[i].score ?? 0).toFixed(3)}`
        });
      }
    }

    // 3) Normalisation globale → somme EXACTE = 1 (si total > 0), sinon retour vide
    let total = target.reduce((a, b) => a + b.weight, 0);
    if (total > EPS) {
      target.forEach(t => (t.weight = Number((t.weight / total).toFixed(4))));
    } else {
      return { target: [] };
    }

    // nettoyer -0.0000
    target.forEach(t => {
      if (Math.abs(t.weight) < EPS) t.weight = 0;
    });

    return { target };
  }
};
