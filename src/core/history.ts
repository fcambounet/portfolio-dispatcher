import fs from "node:fs";
import path from "node:path";

function isoDate(d = new Date()) { return new Date(d).toISOString().slice(0,10); }
function readJSON<T=any>(p: string, fb: T): T { try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,"utf8")); } catch {} return fb; }

export function snapshotWeekly(asOfISO: string) {
  const d = isoDate(asOfISO);
  const base = path.join("data","history");
  const dir = path.join(base, "weekly");
  const sentiDir = path.join(base, "sentiment", d);

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(sentiDir, { recursive: true });

  // 1) snapshot du weekly-summary.json
  const w = readJSON<any>(path.join("data","weekly-summary.json"), null as any);
  if (w) fs.writeFileSync(path.join(dir, `${d}.json`), JSON.stringify(w, null, 2));

  // 2) snapshot du sentiment par secteur
  const analysisDir = path.join("data","research","analysis");
  if (fs.existsSync(analysisDir)) {
    for (const f of fs.readdirSync(analysisDir).filter(x=>x.endsWith(".json"))) {
      const src = path.join(analysisDir, f);
      const dst = path.join(sentiDir, f);
      fs.copyFileSync(src, dst);
    }
  }
}
