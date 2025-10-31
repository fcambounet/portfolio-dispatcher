import type { Agent } from "../core/types.js";
import fs from "node:fs";
import path from "node:path";
import { webSearch } from "../core/web-search.js"; // wrapper générique (qu’on crée ensuite)

export const AnalysteSecteurQuali: Agent<{ sector: string }, any> = {
  name: "AS-Quali",
  handles: ["as.quali"],
  async handle({ sector }) {
    // 🔹 Étape 1 : requête web synthétique
    const q = `Recent trends and key challenges in the ${sector} sector, last 3 months`;
    const results = await webSearch(q, 5);

    // 🔹 Étape 2 : résumé rapide
    const summary = results.map(r => `• ${r.title}`).join("\n");

    // 🔹 Étape 3 : persist
    const outPath = path.join("data", "research", "sectors");
    fs.mkdirSync(outPath, { recursive: true });
    fs.writeFileSync(
      path.join(outPath, `${sector}.json`),
      JSON.stringify({ sector, asOf: new Date().toISOString(), results }, null, 2)
    );

    return { sector, count: results.length, summary };
  }
};
