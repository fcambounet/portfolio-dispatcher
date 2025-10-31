import type { Agent } from "../core/types.js";

export const RecommandateurSectoriel: Agent<{ sector: string }, { topN: any[] }> = {
  name: "RS",
  handles: ["rs.topn"],
  async handle({ sector }) {
    // TODO: read instrument scores, apply rules, and return TopN
    return { topN: [] };
  }
};