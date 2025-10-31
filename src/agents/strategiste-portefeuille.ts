import fs from "node:fs";
import path from "node:path";
import type { Agent } from "../core/types.js";
import { loadConfig } from "../core/config.js";

type Pick = { symbol: string; change?: number; score?: number };
type SectorTop = { sector: string; picks: Pick[] };
type Constraints = { maxLine: number; maxSector: number };

// --- Helpers de lecture d'analytique (quant + quali) ---
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

function loadSectorSentiment(sector: string): "positive" | "neutral" | "negative" | "unknown" {
  const p = path.join("data", "research", "analysis", `${sector}.json`);
  if (!fs.existsSync(p)) return "unknown";
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return (j.sentiment as any) || "unknown";
  } catch {
    return "unknown";
  }
}

export const StrategistePortefeuille: Agent<
  { sectors: SectorTop[]; constraints: Constraints },
  { target: Array<{ symbol: string; weight: number; reason: string }> }
> = {
  name: "SP",
  handles: ["sp.allocate"],

  async handle({ sectors, constraints }) {
    const EPS = 1e-8;
    const ε = 1e-4;

    const cfg = loadConfig();
    const mult = cfg.qualitative?.sentimentMultipliers || {
      positive: 1.10,
      neutral: 1.00,
      negative: 0.90
    };

    // 1) Score sectoriel = score_quant (>=0) × multiplicateur_sentiment
    // score_quant = avgChg5d / (|avgVol20| + ε), clampé à >= 0
    const sectorsScored = sectors.map(s => {
      const agg = loadSectorAgg(s.sector);
      let baseScore = 1; // neutre par défaut
      if (agg && Number.isFinite(agg.avgChg5d) && Number.isFinite(agg.avgVol20)) {
        baseScore = (agg.avgChg5d as number) / (Math.abs(agg.avgVol20 as number) + ε);
      }
      if (!Number.isFinite(baseScore)) baseScore = 0;
      baseScore = Math.max(0, baseScore);

      const sentiment = loadSectorSentiment(s.sector);
      const m =
        sentiment === "positive" ? mult.positive :
        sentiment === "negative" ? mult.negative :
        mult.neutral;

      const sectorScore = baseScore * m; // peut rester 0 si baseScore = 0
      return { ...s, sectorScore, sentiment, baseScore, multiplier: m };
    });

    // Si tous les scores sont 0 → fallback égalitaire
    let sumSectorScore = sectorsScored.reduce((a, b) => a + b.sectorScore, 0);
    const allZero = sumSectorScore <= EPS;
    const sectorsWeighted = (allZero
      ? sectorsScored.map(s => ({ ...s, sectorScore: 1, multiplier: 1, baseScore: 1 }))
      : sectorsScored
    ).map(s => {
      // Normalisation à 1 avant cap maxSector
      const total = allZero ? sectorsScored.length : sumSectorScore;
      const w = (s.sectorScore || 0) / (total || 1);
      return { ...s, sectorWeight: Math.min(w, constraints.maxSector) };
    });

    // 2) Pondération intra-secteur par score de pick (>=0), fallback égalitaire si somme = 0
    const target: Array<{ symbol: string; weight: number; reason: string }> = [];

    for (const s of sectorsWeighted) {
      const picks = s.picks || [];
      const pickScores = picks.map(p => {
        let sc = Number.isFinite(p.score as number) ? (p.score as number) : 0;
        if (!Number.isFinite(sc)) sc = 0;
        return Math.max(0, sc);
      });

      let sumPick = pickScores.reduce((a, b) => a + b, 0);
      if (sumPick <= EPS) {
        // tout à 0 → égalitaire
        pickScores.fill(1);
        sumPick = pickScores.length || 1;
      }

      for (let i = 0; i < picks.length; i++) {
        const frac = pickScores[i] / sumPick;
        let w = s.sectorWeight * frac;
        if (w > constraints.maxLine) w = constraints.maxLine;
        w = Math.max(0, w);

        target.push({
          symbol: picks[i].symbol,
          weight: Number(w.toFixed(4)),
          reason: `Sector=${s.sector}; Sentiment=${s.sentiment}; BaseScore=${s.baseScore.toFixed(3)}; Mult=${s.multiplier.toFixed(2)}; SectorW=${s.sectorWeight.toFixed(3)}; PickScore=${(picks[i].score ?? 0).toFixed(3)}`
        });
      }
    }

    // 3) Normalisation globale → somme EXACTE = 1 si total > 0
    let total = target.reduce((a, b) => a + b.weight, 0);
    if (total > EPS) {
      target.forEach(t => (t.weight = Number((t.weight / total).toFixed(4))));
    } else {
      // aucun poids calculable → portefeuille vide
      return { target: [] };
    }

    // Nettoyage -0.0000
    target.forEach(t => { if (Math.abs(t.weight) < EPS) t.weight = 0; });

    return { target };
  }
};
