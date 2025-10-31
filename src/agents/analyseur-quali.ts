import fs from "node:fs";
import path from "node:path";
import type { Agent } from "../core/types.js";

/**
 * AnalyseurQuali : lit les résultats de recherche (mock ou réels)
 * et extrait mots-clés + tonalité globale par secteur.
 */

export const AnalyseurQuali: Agent<{ sector: string }, any> = {
  name: "AQ",
  handles: ["aq.analyze"],

  async handle({ sector }) {
    const file = path.join("data", "research", "sectors", `${sector}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`⚠️  No qualitative data found for ${sector}`);
      return { sector, keywords: [], sentiment: "neutral" };
    }

    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const texts = (raw.results || []).map((r: any) =>
      `${r.title} ${r.snippet}`.toLowerCase()
    );

    // 🔹 1. Tokenisation très simple
    const words = texts
      .join(" ")
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 4);

    // 🔹 2. Comptage de fréquence
    const freq: Record<string, number> = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;

    // 🔹 3. Top mots-clés
    const keywords = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([w]) => w);

    // 🔹 4. Estimation du sentiment (basée sur mots positifs/négatifs)
    const positive = ["growth", "expansion", "profit", "increase", "innovation", "rise"];
    const negative = ["decline", "loss", "layoff", "crisis", "drop", "decrease"];

    let score = 0;
    for (const w of words) {
      if (positive.includes(w)) score++;
      if (negative.includes(w)) score--;
    }

    let sentiment: "positive" | "neutral" | "negative" = "neutral";
    if (score > 3) sentiment = "positive";
    if (score < -3) sentiment = "negative";

    // 🔹 5. Résumé synthétique
    const summary = `Top keywords: ${keywords.join(", ")} | Sentiment: ${sentiment}`;

    // 🔹 6. Sauvegarde dans data/research/analysis/
    const outDir = path.join("data", "research", "analysis");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `${sector}.json`),
      JSON.stringify({ sector, keywords, sentiment, summary }, null, 2)
    );

    return { sector, keywords, sentiment, summary };
  }
};
