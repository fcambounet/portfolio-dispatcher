// scripts/report.ts
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/core/config.js";

type Target = { symbol: string; weight: number; reason?: string };
type Portfolio = { asOf: string; target: Target[]; riskStatus: "GREEN"|"ORANGE"|"RED"; riskBreaches: string[] };
type Weekly = { date: string; summary: Array<{ sector: string; top: string[] }> };

// ---- util date ----
const asDate = new Date().toISOString().slice(0,10); // YYYY-MM-DD

// ---- data ----
const p: Portfolio = JSON.parse(fs.readFileSync("data/portfolio.target.json","utf8"));
const w: Weekly   = JSON.parse(fs.readFileSync("data/weekly-summary.json","utf8"));

// Map symbol -> sector (via picks de la semaine)
const symToSector = new Map<string,string>();
for (const s of w.summary || []) {
  for (const top of s.top || []) {
    // top est "AAPL (1.23%)" → récupère symbole
    const sym = (top.match(/^([A-Z.\-]+)/)?.[1]) || "";
    if (sym) symToSector.set(sym, s.sector);
  }
}

// palette secteur
const sectorColor: Record<string,string> = {
  Technology:  "#3b82f6",
  Healthcare:  "#10b981",
  Energy:      "#f59e0b",
  Default:     "#64748b"
};

// 💡 Chargement de la configuration YAML
const cfg = loadConfig();

// 💡 Génère un petit encart HTML pour la visualiser dans le rapport
const cfgHTML = `
<details style="margin-top:1rem;padding:0.5rem;border:1px solid #ddd;border-radius:8px;">
  <summary><b>Configuration active</b></summary>
  <pre style="font-size:0.9em;background:#f9fafb;padding:0.5rem;border-radius:6px;overflow-x:auto;">
${JSON.stringify(cfg, null, 2)}
  </pre>
</details>`;

// --- assets: mini sparkline SVG ---
function sparkline(values: number[], w=140, h=36, stroke="#111"): string {
  if (!values.length) return `<svg width="${w}" height="${h}"></svg>`;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const step = w / Math.max(1, values.length-1);
  const pts = values.map((v,i)=>[Math.round(i*step), Math.round(h - ((v-min)/range)*h)]);
  const d = pts.map(([x,y],i)=> (i?`L${x},${y}`:`M${x},${y}`)).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <polyline fill="none" stroke="${stroke}" stroke-width="2" points="${pts.map(p=>p.join(",")).join(" ")}"/>
  </svg>`;
}

// --- read cached closes if present (évitons les fetchs dans le script de rendu) ---
function tryLoadSeries(symbol: string): number[] {
  const cache = path.join("data", `series_${symbol}.json`);
  if (!fs.existsSync(cache)) return [];
  try { return JSON.parse(fs.readFileSync(cache,"utf8")); } catch { return []; }
}

// --- build weights + per-symbol visuals ---
const weights = p.target.map(t => ({
  label: t.symbol,
  value: Math.round(t.weight*10000)/100, // %
  sector: symToSector.get(t.symbol) || "Default"
}));
const maxW = Math.max(10, ...weights.map(x=>x.value));

function barChartSVG(data: {label:string; value:number; sector:string}[]) {
  const width = 660, rowH = 28, pad = 8;
  const height = pad*2 + rowH*data.length;
  const bars = data.map((d,i) => {
    const y = pad + i*rowH;
    const w = Math.round((d.value/maxW) * (width-220));
    const color = sectorColor[d.sector] || sectorColor.Default;
    return `
      <text x="8" y="${y+18}" font-family="ui-sans-serif,system-ui" font-size="13">${d.label}</text>
      <rect x="180" y="${y+6}" width="${w}" height="14" rx="4" fill="${color}"/>
      <text x="${180+w+6}" y="${y+18}" font-family="ui-sans-serif,system-ui" font-size="12" fill="#111">${d.value.toFixed(2)}%</text>
    `;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Allocation">
    <rect width="100%" height="100%" fill="#fff"/>${bars}
  </svg>`;
}

const riskColor = p.riskStatus === "GREEN" ? "#16a34a" : p.riskStatus === "ORANGE" ? "#f59e0b" : "#dc2626";
const rows = p.target
  .sort((a,b)=>b.weight-a.weight)
  .map(t => {
    // On tente de retrouver le secteur et les métriques depuis l’analyse (si présente)
    const sector = symToSector.get(t.symbol) || "—";
    const closes = tryLoadSeries(t.symbol);
    const svg = sparkline(closes.slice(-30), 140, 36, "#334155");

    // NEW: rechercher les métriques du symbole dans les analyses par secteur
    let chg5d: number | undefined;
    let vol20: number | undefined;
    let score: number | undefined;
    for (const s of (w.summary || [])) {
      const sectorPath = path.join("data","sectors", `${s.sector}.json`);
      if (fs.existsSync(sectorPath)) {
        try {
          const json = JSON.parse(fs.readFileSync(sectorPath,"utf8"));
          const m = (json.symbols || []).find((x:any)=>x.symbol===t.symbol);
          if (m) { chg5d = m.chg5d; vol20 = m.vol20; /* score non stocké ici */ }
        } catch {}
      }
    }
    // on peut parse le "reason" (ex. "Score=…") pour remonter le score
    const match = (t.reason || "").match(/Score=([+-]?\d+(\.\d+)?)/);
    if (match) score = Number(match[1]);

    return `<tr>
      <td>${t.symbol}</td>
      <td>${(t.weight*100).toFixed(2)}%</td>
      <td>${sector}</td>
      <td>${svg}</td>
      <td>${(chg5d ?? 0).toFixed(2)}%</td>
      <td>${(vol20 ?? 0).toFixed(3)}</td>
      <td>${(score ?? 0).toFixed(3)}</td>
      <td>${t.reason ?? ""}</td>
    </tr>`;
  })
  .join("");

const sectorsList = (w.summary||[])
  .map(s => `<li><b>${s.sector}</b> : ${s.top.join(", ") || "—"}</li>`)
  .join("");

const breaches = p.riskBreaches?.length
  ? `<ul>${p.riskBreaches.map(b=>`<li>${b}</li>`).join("")}</ul>`
  : "<p>—</p>";

const html = `<!doctype html>
<html lang="fr"><meta charset="utf-8"/>
<title>Rapport Hebdo — Portefeuille (${asDate})</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body { margin:0; background:#f3f4f6; font:14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; color:#0f172a; }
  .wrap { max-width:1024px; margin:32px auto; padding:0 16px; }
  .card { background:#fff; border-radius:16px; box-shadow:0 1px 4px rgba(0,0,0,.08); padding:20px 22px; margin-bottom:16px; }
  h1 { font-size:20px; margin:0 0 8px; } h2 { font-size:16px; margin:16px 0 8px; }
  .grid { display:grid; grid-template-columns:1.3fr .7fr; gap:16px; }
  .badge { display:inline-block; padding:4px 10px; border-radius:999px; color:#fff; background:${riskColor}; font-weight:600; }
  table { width:100%; border-collapse:collapse; } th, td { padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:left; vertical-align:middle; }
  th { color:#374151; font-weight:600; background:#f8fafc; }
  .muted{ color:#6b7280 } footer{ color:#6b7280; font-size:12px; margin-top:4px}
  .legend span{display:inline-block;margin-right:12px;padding-left:14px;position:relative}
  .legend span::before{content:'';width:10px;height:10px;border-radius:2px;position:absolute;left:0;top:3px;background:#999}
  .legend .tech::before{background:${sectorColor.Technology}}
  .legend .health::before{background:${sectorColor.Healthcare}}
  .legend .energy::before{background:${sectorColor.Energy}}
</style>
<div class="wrap">
  <div class="card">
    <h1>📊 Rapport hebdo — Portefeuille <span class="badge">Risque : ${p.riskStatus}</span></h1>
    <div class="muted">Généré le ${new Date().toLocaleString("fr-FR")} • Données au ${new Date(p.asOf).toLocaleString("fr-FR")}</div>
    ${cfgHTML}
    <div class="legend" style="margin-top:8px">
      <span class="tech">Technology</span>
      <span class="health">Healthcare</span>
      <span class="energy">Energy</span>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Allocation cible</h2>
      <div style="overflow:auto; margin:8px 0 12px">${barChartSVG(weights)}</div>
      <table>
        <thead>
          <tr>
            <th>Symbole</th><th>Poids</th><th>Secteur</th><th>30j</th>
            <th>chg5d</th><th>vol20</th><th>score</th><th>Raison</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted">Aucune ligne</td></tr>'}</tbody>
      </table>
    </div>
    <div>
      <div class="card">
        <h2>Picks par secteur</h2>
        <ul style="margin:0; padding-left:18px">${sectorsList || "<li class='muted'>—</li>"}</ul>
      </div>
      <div class="card">
        <h2>Contrôles de risque</h2>
        ${breaches}
      </div>
    </div>
  </div>

  <footer class="wrap muted">© Rapport généré par pipeline portfolio-agents</footer>
</div>
</html>`;

// sortie : un fichier daté + "latest"
fs.mkdirSync("report", { recursive: true });
const dated = path.join("report", `weekly-report-${asDate}.html`);
const latest = path.join("report", "weekly-report.html");
fs.writeFileSync(dated, html);
fs.writeFileSync(latest, html);

// index: liste les rapports (simples liens)
const files = fs.readdirSync("report").filter(f => /^weekly-report-\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().reverse();
const links = files.map(f => `<li><a href="./${f}">${f.replace("weekly-report-","").replace(".html","")}</a></li>`).join("");
const index = `<!doctype html><meta charset="utf-8"><title>Rapports hebdo</title>
<link rel="stylesheet" href="https://unpkg.com/modern-css-reset/dist/reset.min.css">
<style>body{font:16px/1.5 system-ui;padding:24px;max-width:720px;margin:0 auto;color:#0f172a}h1{font-size:22px}</style>
<h1>Rapports hebdomadaires</h1>
<p><a href="./weekly-report.html">Dernier (latest)</a></p>
<ul>${links}</ul>`;
fs.writeFileSync(path.join("report","index.html"), index);

console.log("Report written:", dated, "and latest:", latest);
