import type { Agent } from "../core/types.js";

export const RiskManager: Agent<{ target: { symbol: string; weight: number }[], limits: { maxLine: number; maxSector: number } }, { status: string; breaches: string[] }> = {
  name: "RM",
  handles: ["rm.check"],
  async handle({ target, limits }) {
    const breaches: string[] = [];
    for (const t of target) {
      if (t.weight > limits.maxLine + 1e-8) breaches.push(`Line ${t.symbol} exceeds maxLine ${limits.maxLine}`);
    }
    const status = breaches.length ? "ORANGE" : "GREEN";
    return { status, breaches };
  }
};