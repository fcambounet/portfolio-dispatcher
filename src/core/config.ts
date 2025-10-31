import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type PortfolioConfig = {
  sectors: { name: string; symbols: string[] }[];
  constraints: { maxLine: number; maxSector: number };
  scoring: {
    formula: "ratio" | "linear";
    w5: number; w20: number; lambda: number; eps: number;
  };
  risk: { targetVol: number; maxDrawdown: number };
};

let cached: PortfolioConfig | null = null;

export function loadConfig(): PortfolioConfig {
  if (cached) return cached;
  const p = path.join("config", "portfolio.yml");
  const txt = fs.readFileSync(p, "utf8");
  const data = YAML.parse(txt) as PortfolioConfig;
  cached = data;
  return data;
}
