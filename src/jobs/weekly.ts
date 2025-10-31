import { appendJSONL } from "../core/io.js";
import { AnalysteSectoriel } from "../agents/analyste-sectoriel.js";
import { RecommandateurSectoriel } from "../agents/recommandateur-sectoriel.js";

const SECTORS = ["Technology", "Healthcare", "Energy"];

export async function runWeekly() {
  for (const sector of SECTORS) {
    const as = await AnalysteSectoriel.handle({ sector });
    appendJSONL("recos.jsonl", { sector, as });
    const rs = await RecommandateurSectoriel.handle({ sector });
    appendJSONL("recos.jsonl", { sector, rs });
  }
  appendJSONL("exec.log.jsonl", { action: "weekly.completed" });
}