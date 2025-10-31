// scripts/report.ts
import fs from "node:fs";
import path from "node:path";

type Target = { symbol: string; weight: number; reason?: string };
type Portfolio = { asOf: string; target: Target[]; riskStatus: "GREEN"|"ORANGE"|"RED"; riskBreaches: string[] };
type Weekly = { date: string; summary: Array<{ sector: string; top: string[] }> };

const p: Portfolio = JSON.parse(fs.readFileSync("data/portfolio.target.json","utf8"));
const w: Weekly   = JSON.parse(fs.readFileSync("data/weekly-summary.json","utf8"));

const bySector = w.summary;
const weights = p.target.map(t => ({ label: t.symbol, value: Math.round(t.weight*10000)/100 })); // %
const maxW = Math.max(10, ...weights.map(x=>x.value));

function barChartSVG(data: {label:string; value:number}[]) {
  const width = 640, rowH = 26, pad = 8;
  const height = pad*2 + rowH*data.length;
  const bars = data.map((d,i) => {
    const y = pad + i*rowH;
    const w = Math.round((d.value/maxW) * (width-200));
    return `
      <text x="8" y="${y+18}" font-family="ui-sans-serif,system-ui" font-size="13">${d.label}</text>
      <rect x="160" y="${y+6}" width="${w}" height="14" rx="4" fill="#3b82f6"/>
      <text x="${160+w+6}" y="${y+18}" font-family="ui-sans-serif,system-ui" font-size="12" fill="#111">${d.value.toFixed(2)}%</text>
    `;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Allocation">
    <rect width="100%" height="100%" fill="#fff"/>
    ${bars}
  </svg>`;
}

const riskColor = p.riskStatus === "GREEN" ? "#16a34a" : p.riskStatus === "ORANGE" ? "#f59e0b" : "#dc2626";

const rows = p.target
  .sort((a,b)=>b.weight-a.weight)
  .map(t => `<tr><td>${t.symbol}</td><td>${(t.weight*100).toFixed(2)}%</td><td>${t.reason ?? ""}</td></tr>`)
  .join("");

const sectors = bySector
  .map(s => `<li><b>${s.sector}</b> : ${s.top.join(", ") || "—"}</li>`)
  .join("");

const breaches = p.riskBreaches?.length
  ? `<ul>${p.riskBreaches.map(b=>`<li>${b}</li>`).join("")}</ul>`
  : "<p>—</p>";

const html = `<!doctype html>
<html lang="fr">
<meta charset="utf-8"/>
<title>Rapport Hebdo — Portefeuille</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root { --bg:#0b1220; --card:#ffffff; --muted:#6b7280; }
  body { margin:0; background:#f3f4f6; font:14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; color:#0f172a; }
  .wrap { max-width:980px; margin:32px auto; padding:0 16px; }
  .card { background:#fff; border-radius:16px; box-shadow:0 1px 4px rgba(0,0,0,.08); padding:20px 22px; margin-bottom:16px; }
  h1 { font-size:20px; margin:0 0 8px; }
  h2 { font-size:16px; margin:16px 0 8px; }
  .grid { display:grid; grid-template-columns:1.2fr .8fr; gap:16px; }
  .badge { display:inline-block; padding:4px 10px; border-radius:999px; color:#fff; background:${riskColor}; font-weight:600; }
  table { width:100%; border-collapse:collapse; }
  th, td { padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:left; }
  th { color:#374151; font-weight:600; background:#f8fafc; }
  .muted{ color:#6b7280 }
  footer{ color:#6b7280; font-size:12px; margin-top:4px}
</style>
<div class="wrap">
  <div class="card">
    <h1>📊 Rapport hebdo — Portefeuille</h1>
    <div class="muted">Généré le ${new Date().toLocaleString("fr-FR")} • Données au ${new Date(p.asOf).toLocaleString("fr-FR")}</div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Allocation cible <span class="badge">Risque : ${p.riskStatus}</span></h2>
      <div style="overflow:auto; margin:8px 0 12px">${barChartSVG(weights)}</div>
      <table>
        <thead><tr><th>Symbole</th><th>Poids</th><th>Raison</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="muted">Aucune ligne</td></tr>'}</tbody>
      </table>
    </div>
    <div>
      <div class="card">
        <h2>Picks par secteur</h2>
        <ul style="margin:0; padding-left:18px">${sectors || "<li class='muted'>—</li>"}</ul>
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

fs.mkdirSync("report", { recursive: true });
const out = path.join("report", "weekly-report.html");
fs.writeFileSync(out, html);
console.log("Report written:", out);
