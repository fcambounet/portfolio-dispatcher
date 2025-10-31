import type { Agent } from "../core/types.js";

type Target = { symbol: string; weight: number };
type RiskResult = {
  volatility: number;
  concentration: number;
  status: "GREEN" | "YELLOW" | "RED";
  message: string;
};

export const RiskManager: Agent<{ target: Target[] }, RiskResult> = {
  name: "RM",
  handles: ["rm.assess"],

  async handle({ target }) {
    if (!target || target.length === 0) {
      return {
        volatility: 0,
        concentration: 0,
        status: "RED",
        message: "No positions in portfolio."
      };
    }

    // 🔹 1. Calcul de la concentration (Herfindahl–Hirschman Index)
    const sumW2 = target.reduce((acc, t) => acc + (t.weight || 0) ** 2, 0);
    const concentration = Number(sumW2.toFixed(4));

    // 🔹 2. Estimation simplifiée de la volatilité (dispersion)
    const meanW = target.reduce((a, b) => a + (b.weight || 0), 0) / target.length;
    const variance =
      target.reduce((a, b) => a + ((b.weight || 0) - meanW) ** 2, 0) / target.length;
    const volatility = Number(Math.sqrt(variance).toFixed(4));

    // 🔹 3. Seuils et statut
    let status: "GREEN" | "YELLOW" | "RED" = "GREEN";
    let message = "Portfolio risk is within acceptable range.";

    if (concentration > 0.2 || volatility > 0.05) {
      status = "YELLOW";
      message = "Moderate concentration or volatility detected.";
    }
    if (concentration > 0.35 || volatility > 0.10) {
      status = "RED";
      message = "High portfolio concentration or volatility risk.";
    }

    // 🔹 4. Retour
    const result: RiskResult = { volatility, concentration, status, message };
    console.log(`🛡️  RiskManager → ${status} (vol=${volatility}, conc=${concentration})`);
    return result;
  }
};
