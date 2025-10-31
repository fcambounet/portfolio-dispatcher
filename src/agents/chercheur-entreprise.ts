import type { Agent } from "../core/types.js";
import fs from "node:fs";
import path from "node:path";
import { webSearch } from "../core/web-search.js";

export const ChercheurEntreprise: Agent<{ symbol: string }, any> = {
  name: "CE",
  handles: ["ce.find"],
  async handle({ symbol }) {
    const q = `Key news, products and strategic developments about ${symbol} stock, last 3 months`;
    const results = await webSearch(q, 5);

    const outPath = path.join("data", "research", "companies");
    fs.mkdirSync(outPath, { recursive: true });
    fs.writeFileSync(
      path.join(outPath, `${symbol}.json`),
      JSON.stringify({ symbol, asOf: new Date().toISOString(), results }, null, 2)
    );

    return { symbol, count: results.length };
  }
};
