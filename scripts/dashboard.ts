// scripts/dashboard.ts
import fs from "node:fs";
import path from "node:path";

/* -------- helpers -------- */
function readJSON<T=any>(p: string, fb: T): T { try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,"utf8")); } catch {} return fb; }
function iso(d = new Date()) { return new Date(d).toISOString().slice(0,10); }
function sentimentToNum(s?: string) { return s==="positive"?1: s==="negative"?-1: 0; }

/* -------- charger weekly courant -------- */
const weekly = readJSON<any>(path.join("data","weekly-summary.json"), null as any);
const target = Array.isArray(weekly?.target) ? weekly.target : [];
const sectorsEntries: Array<{ sector:string, top?:string[] }> = Array.isArray(weekly?.sectors) ? weekly.sectors : [];
const sectors = Array.from(new Set(sectorsEntries.map(s=>s.sector)));

/* -------- mapping symbole -> secteur -------- */
const symToSector = new Map<string,string>();
for (const s of sectorsEntries) {
  for (const t of (s.top||[])) {
    const sym = t.match(/^([A-Z.\-]+)/)?.[1];
    if (sym) symToSector.set(sym, s.sector);
  }
}
// fallback via fichiers data/sectors
for (const t of target) {
  if (!symToSector.has(t.symbol)) {
    for (const sec of sectors) {
      const j = readJSON<any>(path.join("data","sectors",`${sec}.json`), null as any);
      if (j?.symbols?.some((x:any)=>x.symbol===t.symbol)) { symToSector.set(t.symbol, sec); break; }
    }
    if (!symToSector.has(t.symbol)) symToSector.set(t.symbol, "Default");
  }
}

/* -------- 1) Pie allocation par secteur -------- */
const sectorWeights = new Map<string, number>();
for (const t of target) {
  const sec = symToSector.get(t.symbol) || "Default";
  sectorWeights.set(sec, (sectorWeights.get(sec)||0) + (t.weight||0));
}
const pieData = Array.from(sectorWeights.entries())
  .map(([label,val])=>({label, value: Math.round(val*10000)/100}));

function pieSVG(data:{label:string;value:number}[], size=280) {
  const total = data.reduce((a,b)=>a+b.value,0) || 1;
  const cx = size/2, cy=size/2, r=size/2 - 6;
  let a0 = -Math.PI/2;
  const colors = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#84cc16","#64748b"];
  const arcs = data.map((d,i)=>{
    const a1 = a0 + (2*Math.PI)*(d.value/total);
    const x0 = cx + r*Math.cos(a0), y0 = cy + r*Math.sin(a0);
    const x1 = cx + r*Math.cos(a1), y1 = cy + r*Math.sin(a1);
    const large = (a1-a0)>Math.PI ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
    a0 = a1;
    return `<path d="${path}" fill="${colors[i%colors.length]}"><title>${d.label}: ${d.value.toFixed(2)}%</title></path>`;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}</svg>`;
}

/* -------- 2) Trend du sentiment (N dernières semaines) -------- */
const HIST_DIR = path.join("data","history","sentiment");
const weeks = fs.existsSync(HIST_DIR)
  ? fs.readdirSync(HIST_DIR).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort().slice(-8) // 8 dernières
  : [];
// construit: sector -> array of {date, val}
const sentiMap = new Map<string, Array<{x:string,y:number}>>();
for (const d of weeks) {
  for (const sec of sectors) {
    const f = path.join(HIST_DIR, d, `${sec}.json`);
    const s = readJSON<any>(f, null as any);
    const v = sentimentToNum(s?.sentiment);
    if (!sentiMap.has(sec)) sentiMap.set(sec, []);
    sentiMap.get(sec)!.push({ x: d, y: v });
  }
}
function smallLine(points:{x:string,y:number}[], w=180, h=50) {
  if (!points.length) return `<svg width="${w}" height="${h}"></svg>`;
  const ys = points.map(p=>p.y);
  const min = Math.min(...ys, -1), max = Math.max(...ys, 1);
  const range = max-min || 1;
  const step = w / Math.max(1, points.length-1);
  const pts = points.map((p,i)=>`${Math.round(i*step)},${Math.round(h - ((p.y-min)/range)*h)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#fff"/>
    <line x1="0" y1="${Math.round(h-((0-min)/range)*h)}" x2="${w}" y2="${Math.round(h-((0-min)/range)*h)}" stroke="#e5e7eb"/>
    <polyline fill="none" stroke="#111827" stroke-width="2" points="${pts}"/>
  </svg>`;
}

/* -------- 3) Top movers (chg5d) -------- */
type Row = { symbol:string; sector:string; chg5d:number };
const rows: Row[] = [];
for (const sec of sectors) {
  const f = path.join("data","sectors",`${sec}.json`);
  const j = readJSON<any>(f, null as any);
  for (const m of (j?.symbols||[])) {
    const chg = Number(m.chg5d);
    if (Number.isFinite(chg)) rows.push({ symbol:m.symbol, sector:sec, chg5d: chg });
  }
}
rows.sort((a,b)=>b.chg5d - a.chg5d);
const topUp = rows.slice(0,5);
const topDn = rows.slice(-5).reverse();

/* -------- HTML -------- */
const html = `<!doctype html><meta charset="utf-8">
<title>Dashboard Portefeuille — ${iso()}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;background:#f3f4f6;color:#0f172a;font:14px/1.5 ui-sans-serif,system-ui}
  .wrap{max-width:1100px;margin:28px auto;padding:0 16px}
  .card{background:#fff;border-radius:16px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:20px 22px;margin-bottom:16px}
  h1{font-size:20px;margin:0 0 8px} h2{font-size:16px;margin:0 0 8px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  table{width:100%;border-collapse:collapse} th,td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left}
  th{background:#f8fafc}
  .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#e5e7eb;color:#111}
</style>
<div class="wrap">
  <div class="card">
    <h1>📈 Dashboard — Portefeuille</h1>
    <div class="pill">Généré le ${new Date().toLocaleString("fr-FR")}</div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Allocation par secteur</h2>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        ${pieSVG(pieData, 280)}
        <div>
          ${pieData.map(d=>`<div style="margin:4px 0">${d.label}: <b>${d.value.toFixed(2)}%</b></div>`).join("") || "<div class='pill'>Aucune donnée</div>"}
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Tendance du sentiment (dernières ${weeks.length || 0} semaines)</h2>
      ${
        sectors.length
          ? sectors.map(sec=>{
              const pts = sentiMap.get(sec) || [];
              return `<div style="display:flex;align-items:center;justify-content:space-between;margin:6px 0">
                <div style="width:140px"><b>${sec}</b></div>
                ${smallLine(pts, 200, 50)}
              </div>`;
            }).join("")
          : "<div class='pill'>Pas encore d’historique — laisse tourner quelques runs.</div>"
      }
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Top 5 hausses (5j)</h2>
      <table><thead><tr><th>Symbole</th><th>Secteur</th><th>chg5d</th></tr></thead>
      <tbody>
        ${topUp.length ? topUp.map(r=>`<tr><td>${r.symbol}</td><td>${r.sector}</td><td>${r.chg5d.toFixed(2)}%</td></tr>`).join("") : "<tr><td colspan='3'>—</td></tr>"}
      </tbody></table>
    </div>
    <div class="card">
      <h2>Top 5 baisses (5j)</h2>
      <table><thead><tr><th>Symbole</th><th>Secteur</th><th>chg5d</th></tr></thead>
      <tbody>
        ${topDn.length ? topDn.map(r=>`<tr><td>${r.symbol}</td><td>${r.sector}</td><td>${r.chg5d.toFixed(2)}%</td></tr>`).join("") : "<tr><td colspan='3'>—</td></tr>"}
      </tbody></table>
    </div>
  </div>

  <div class="card">
    <h2>Liens utiles</h2>
    <ul>
      <li><a href="./weekly-report.html">Rapport hebdo</a></li>
      <li><a href="../data/audit/latest.json">Audit (latest)</a></li>
    </ul>
  </div>
</div>`;
fs.mkdirSync("report", { recursive: true });
fs.writeFileSync(path.join("report","dashboard.html"), html);
console.log("Dashboard written: report/dashboard.html");
