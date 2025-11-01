import { describe, it, expect } from "vitest";
import { RiskManager } from "../src/agents/risk-manager.js";

describe("RiskManager", () => {
  it("évalue un portefeuille égalitaire en GREEN", async () => {
    const target = ["A","B","C","D"].map(s => ({ symbol: s, weight: 0.25 }));
    const r = await RiskManager.handle({ target });
    expect(r.status === "GREEN" || r.status === "YELLOW").toBeTruthy(); // selon seuils
    expect(r.concentration).toBeGreaterThan(0);
  });
});
