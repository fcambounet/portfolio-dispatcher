import { describe, it, expect } from "vitest";
import { StrategistePortefeuille } from "../src/agents/strategiste-portefeuille.js";

describe("StrategistePortefeuille", () => {
  it("normalise à 100% et respecte maxLine", async () => {
    const sectors = [
      { sector: "Technology", picks: [{symbol:"AAPL",score:1},{symbol:"MSFT",score:1}] },
      { sector: "Healthcare", picks: [{symbol:"JNJ",score:1}] },
    ];
    const constraints = { maxLine: 0.5, maxSector: 0.8 };
    const { target } = await StrategistePortefeuille.handle({ sectors, constraints });
    const sum = Number(target.reduce((a,b)=>a+(b.weight||0),0).toFixed(6));
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
    for (const t of target) expect(t.weight).toBeLessThanOrEqual(constraints.maxLine + 1e-6);
    for (const t of target) expect(t.weight).toBeGreaterThanOrEqual(0);
  });
});
