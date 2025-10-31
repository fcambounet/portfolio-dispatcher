import type { Agent } from "../core/types.js";

export const AnalysteSectoriel: Agent<{ sector: string }, { bulletin: string }> = {
  name: "AS",
  handles: ["as.update"],
  async handle({ sector }) {
    // TODO: plug real market/macro connectors; for now return a stub
    const bulletin = `Tendances ${sector}: scénarios base/haussier/baissier, KPIs…`;
    return { bulletin };
  }
};