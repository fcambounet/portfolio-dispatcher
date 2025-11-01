// scripts/report.ts
import fs from "node:fs";
import path from "node:path";

const checks = safeReadJSON<any>(path.join("data","checks.json"), null as any);
const auditLatest = path.join("data","audit","latest.json");
const auditExists = fs.existsSync(auditLatest);

/* ----------------------------- helpers ----------------------------- */

function safeReadJSON<T = any>(p: string, fallback: T): T {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {}
  return fallback;
}

function asISODate(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

function readSentiment(sector: string): "positive" | "neutral" | "negative" | "unknown" {
  const p = path.join("data", "research", "analysis", `${sector}.json`);
  const j = safeReadJSON(p, null as any);
  return j?.sentiment ?? "unknown";
}

function readSeries(symbol: string): number[] {
  const p = path.join("data", `series_${symbol}.json`);
  const arr = safeReadJSON<number[]>(p, []);
  return Array.isArray(arr) ? arr.filter((x) => Number.isFinite(x)) : [];
}

function loadSectorMetricsMap(sectors: string[]) {
  // Map symbole -> { chg5d, vol20 }
  const map = new Map<string, { chg5d?: number; vol20?: number }>();
  for (const s of sectors) {
    const f = path.join("data", "sectors", `${s}.json`);
    const j = safeReadJSON<any>(f, null as any);
    const list: any[] = j?.symbols || [];
    for (const m of list) {
      if (!m?.symbol) continue;
      map.set(m.symbol, { chg5d: m.chg5d, vol20: m.vol20 });
    }
  }
  return map;
}

function sparkline(values: number[], w = 140, h = 36, stroke = "#334155") {
  if (!values || values.length === 0) return `<svg width="${w}" height="${h}"></svg>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [Math.round(i * step), Math.round(h - ((v - min) / range) * h)]);
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <polyline fill="none" stroke="${stroke}" stroke-width="2" points="${pts.map((p) => p.join(",")).join(" ")}"/>
  </svg>`;
}

const sectorColor: Record<string, string> = {
  Technology: "#3b82f6",
  Healthcare: "#10b981",
  Energy: "#f59e0b",
  Default: "#64748b",
};

function barChartSVG(data: { label: string; value: number; sector: string }[]) {
  const width = 660,
    rowH = 28,
    pad = 8;
  const height = pad * 2 + rowH * data.length;
  const maxV = Math.max(10, ...data.map((d) => d.value));
  const bars = data
    .map((d, i) => {
      const y = pad + i * rowH;
      const w = Math.round((d.value / maxV) * (width - 220));
      const color = sectorColor[d.sector] || sectorColor.Default;
      return `
      <text x="8" y="${y + 18}" font-family="ui-sans-serif,system-ui" font-size="13">${d.label}</text>
      <rect x="180" y="${y + 6}" width="${w}" height="14" rx="4" fill="${color}"/>
      <text x="${180 + w + 6}" y="${y + 18}" font-family="ui-sans-serif,system-ui" font-size="12" fill="#111">${d.value.toFixed(2)}%</text>
    `;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Allocation">
    <rect width="100%" height="100%" fill="#fff"/>${bars}
  </svg>`;
}

function parseScoreFromReason(reason?: string): number | undefined {
  if (!reason) return undefined;
  // Cherche d'abord PickScore=..., sinon Score=...
  const m1 = reason.match(/PickScore=([+-]?\d+(\.\d+)?)/);
  if (m1) return Number(m1[1]);
  const m2 = reason.match(/Score=([+-]?\d+(\.\d+)?)/);
  if (m2) return Number(m2[1]);
  return undefined;
}

function readCSV(p: string): string[][] {
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").trim().split("\n");
  return lines.slice(1).map(l => l.split(","));
}

function lineChartSVG(points: {x:string,y:number,y2?:number}[], w=660, h=180) {
  if (!points.length) return `<svg width="${w}" height="${h}"></svg>`;
  const xs = points.map((p,i)=>i);
  const ys = points.map(p=>p.y);
  const y2s = points.map(p=>p.y2 ?? NaN).filter(n=>Number.isFinite(n)) as number[];

  const minY = Math.min(...ys, ...(y2s.length?y2s:[Infinity]));
  const maxY = Math.max(...ys, ...(y2s.length?y2s:[-Infinity]));
  const rangeY = maxY - minY || 1;
  const stepX = w / Math.max(1, points.length - 1);

  const poly = (arr:number[]) =>
    arr.map((v,i)=>`${Math.round(i*stepX)},${Math.round(h - ((v - minY)/rangeY)*h)}`).join(" ");

  const navPts = poly(ys);
  const benchPts = y2s.length ? poly(points.map(p=>p.y2 ?? NaN)) : "";

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#fff"/>
    ${benchPts ? `<polyline fill="none" stroke="#9ca3af" stroke-width="2" points="${benchPts}"/>` : ""}
    <polyline fill="none" stroke="#2563eb" stroke-width="2" points="${navPts}"/>
  </svg>`;
}

/* ----------------------------- chargement données ----------------------------- */

// weekly-summary contient: { asOf, sectors:[{sector, top:[...] }], risk, target }
const weekly = safeReadJSON<any>(path.join("data", "weekly-summary.json"), null as any);

// Fallback si besoin
const targetFallback = safeReadJSON<any>(path.join("data", "portfolio.target.json"), []);
const riskFallback = safeReadJSON<any>(path.join("data", "portfolio.risk.json"), null as any);

// Source des cibles
const target: Array<{ symbol: string; weight: number; reason?: string }> =
  Array.isArray(weekly?.target) ? weekly.target : Array.isArray(targetFallback) ? targetFallback : [];

// Risk status
const riskStatus: string =
  weekly?.risk?.status ?? riskFallback?.status ?? "UNKNOWN";

// Date de référence
const asOf: string = weekly?.asOf ?? new Date().toISOString();

// Secteurs présents (pour badges + métriques)
const sectorEntries: Array<{ sector: string; top?: string[] }> = Array.isArray(weekly?.sectors)
  ? weekly.sectors
  : [];

const sectorsUnique = Array.from(new Set(sectorEntries.map((s) => s.sector)));
const symToSector = new Map<string, string>();
for (const s of sectorEntries) {
  for (const top of s.top || []) {
    const sym = top.match(/^([A-Z.\-]+)/)?.[1];
    if (sym) symToSector.set(sym, s.sector);
  }
}

const navRows = readCSV(path.join("data","ledger","nav.csv"));
const navPoints = navRows.map(r => ({ x: r[0], y: Number(r[1]||"0"), y2: Number(r[4]||"") }));
const tradesRows = readCSV(path.join("data","ledger","trades.csv"));
const lastTrades = tradesRows.filter(r => r[0] === asISODate(asOf));

// Cash & NAV courants (depuis la dernière ligne de nav.csv)
const lastNavRow = navRows.length ? navRows[navRows.length - 1] : null;
// nav.csv: date,nav,cash,value,benchmark
const currentNAV  = lastNavRow ? Number(lastNavRow[1] || "0") : 0;
const currentCash = lastNavRow ? Number(lastNavRow[2] || "0") : 0;
const cashPct     = currentNAV > 0 ? (currentCash / currentNAV) * 100 : 0;

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

// au cas où aucun mapping via summary → déduire secteur via présence dans fichiers
for (const t of target) {
  if (!symToSector.has(t.symbol)) {
    // essaie naïvement: choisis le premier secteur existant contenant le symbole
    for (const sec of sectorsUnique) {
      const file = path.join("data", "sectors", `${sec}.json`);
      const j = safeReadJSON<any>(file, null as any);
      if (j?.symbols?.some((x: any) => x.symbol === t.symbol)) {
        symToSector.set(t.symbol, sec);
        break;
      }
    }
    if (!symToSector.has(t.symbol)) symToSector.set(t.symbol, "Default");
  }
}

// Map symbole -> métriques (chg5d, vol20)
const metricsMap = loadSectorMetricsMap(sectorsUnique);

/* ----------------------------- rendu ----------------------------- */

const riskColor =
  riskStatus === "GREEN" ? "#16a34a" : riskStatus === "ORANGE" || riskStatus === "YELLOW" ? "#f59e0b" : riskStatus === "RED" ? "#dc2626" : "#64748b";

const weights = target
  .map((t) => ({
    label: t.symbol,
    value: Math.round((t.weight || 0) * 10000) / 100, // en %
    sector: symToSector.get(t.symbol) || "Default",
  }))
  .sort((a, b) => b.value - a.value);

const tableRows = target
  .slice()
  .sort((a, b) => (b.weight || 0) - (a.weight || 0))
  .map((t) => {
    const sector = symToSector.get(t.symbol) || "—";
    const closes = readSeries(t.symbol);
    const svg = sparkline(closes.slice(-30), 140, 36, "#334155");
    const m = metricsMap.get(t.symbol) || {};
    const score = parseScoreFromReason(t.reason);
    return `<tr>
      <td>${t.symbol}</td>
      <td>${((t.weight || 0) * 100).toFixed(2)}%</td>
      <td>${sector}</td>
      <td>${svg}</td>
      <td>${Number.isFinite(m.chg5d) ? (m.chg5d as number).toFixed(2) + "%" : "—"}</td>
      <td>${Number.isFinite(m.vol20) ? (m.vol20 as number).toFixed(3) : "—"}</td>
      <td>${Number.isFinite(score as number) ? (score as number).toFixed(3) : "—"}</td>
      <td>${t.reason ?? ""}</td>
    </tr>`;
  })
  .join("");

// Badges de sentiment sectoriel
const sectorBadges = sectorsUnique
  .map((sec) => {
    const sent = readSentiment(sec);
    const color = sent === "positive" ? "#16a34a" : sent === "negative" ? "#dc2626" : "#6b7280";
    return `<span style="display:inline-block;margin:4px 8px 0 0;padding:4px 8px;border-radius:999px;background:${color};color:#fff;font-size:12px">
      ${sec}: ${sent.toUpperCase()}
    </span>`;
  })
  .join("");

// total poids pour contrôle
const totalPct = (target.reduce((a, b) => a + (b.weight || 0), 0) * 100).toFixed(2);

// HTML complet
const html = `<!doctype html>
<html lang="fr"><meta charset="utf-8"/>
<title>Rapport Hebdo — Portefeuille (${asISODate(asOf)})</title>
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
    <h1>📊 Rapport hebdo — Portefeuille <span class="badge">Risque : ${riskStatus}</span></h1>
    <div class="muted">Généré le ${new Date().toLocaleString("fr-FR")} • Données au ${new Date(asOf).toLocaleString("fr-FR")} • Total=${totalPct}%</div>
    <div class="legend" style="margin-top:8px">
      <span class="tech">Technology</span>
      <span class="health">Healthcare</span>
      <span class="energy">Energy</span>
    </div>
  </div>

  ${sectorBadges ? `<div class="card"><h2>Sentiment sectoriel</h2><div>${sectorBadges}</div></div>` : ""}

  <div class="card">
    <h2>Évolution NAV (Portefeuille vs Benchmark)</h2>
    <div style="overflow:auto; margin:8px 0 4px">${lineChartSVG(navPoints)}</div>
    <div class="muted">Bleu = NAV portefeuille • Gris = Benchmark (base 100)</div>
  </div>

  <div class="card">
    <h2>Cash restant</h2>
    <p style="margin:6px 0 0">
      Trésorerie disponible : <b>${fmt(currentCash)}</b>
      (<span class="muted">${fmt(cashPct)}% de la NAV</span>)
    </p>
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
        <tbody>${tableRows || '<tr><td colspan="8" class="muted">Aucune ligne</td></tr>'}</tbody>
      </table>
    </div>
    <div>
      <div class="card">
        <h2>Picks par secteur</h2>
        <ul style="margin:0; padding-left:18px">
          ${
            sectorEntries.length
              ? sectorEntries
                  .map(
                    (s) =>
                      `<li><b>${s.sector}</b> : ${(s.top || []).join(", ") || "—"}</li>`
                  )
                  .join("")
              : "<li class='muted'>—</li>"
          }
        </ul>
      </div>
      <div class="card">
        <h2>Contrôles de risque</h2>
        ${
          weekly?.risk
            ? `<ul>
                 <li>Status: <b>${weekly.risk.status}</b></li>
                 <li>Volatility: ${weekly.risk.volatility}</li>
                 <li>Concentration: ${weekly.risk.concentration}</li>
               </ul>`
            : "<p>—</p>"
        }
      </div>
      <div class="card">
        <h2>Qualité & Audit</h2>
        ${
          checks
            ? (checks.ok
                ? `<p style="color:#16a34a"><b>Sanity checks: OK</b></p>`
                : `<p style="color:#dc2626"><b>Sanity checks: ${checks.issues?.length || 0} issue(s)</b></p>
                   <ul style="margin-top:6px">${(checks.issues||[]).map((i:any)=>`<li>[${i.severity}] ${i.code} — ${i.message}</li>`).join("")}</ul>`
              )
            : `<p class="muted">—</p>`
        }
        ${auditExists ? `<p style="margin-top:8px"><a href="../data/audit/latest.json">Télécharger l’audit (latest.json)</a></p>` : ""}
      </div>
      <div class="card">
        <h2>Trades de la semaine</h2>
        ${
          lastTrades.length
            ? `<table><thead><tr><th>Symbole</th><th>Qté</th><th>Px</th><th>Valeur</th></tr></thead>
                <tbody>${
                  lastTrades.map(r =>
                    `<tr><td>${r[1]}</td><td>${Number(r[2]).toFixed(4)}</td><td>${Number(r[3]).toFixed(2)}</td><td>${Number(r[4]).toFixed(2)}</td></tr>`
                  ).join("")
                }</tbody></table>`
            : `<p class="muted">Aucun trade ce jour (${asISODate(asOf)}).</p>`
        }
      </div>
    </div>
  </div>

  <footer class="wrap muted">© Rapport généré par pipeline portfolio-agents</footer>
</div>
</html>`;

/* ----------------------------- sorties ----------------------------- */

fs.mkdirSync("report", { recursive: true });
const dated = path.join("report", `weekly-report-${asISODate()}.html`);
const latest = path.join("report", "weekly-report.html");
fs.writeFileSync(dated, html);
fs.writeFileSync(latest, html);

// index: liste liens des rapports datés
const files = fs
  .readdirSync("report")
  .filter((f) => /^weekly-report-\d{4}-\d{2}-\d{2}\.html$/.test(f))
  .sort()
  .reverse();

const links = files
  .map(
    (f) =>
      `<li><a href="./${f}">${f.replace("weekly-report-", "").replace(".html", "")}</a></li>`
  )
  .join("");

const index = `<!doctype html><meta charset="utf-8"><title>Rapports hebdo</title>
<link rel="stylesheet" href="https://unpkg.com/modern-css-reset/dist/reset.min.css">
<style>body{font:16px/1.5 system-ui;padding:24px;max-width:720px;margin:0 auto;color:#0f172a}h1{font-size:22px}</style>
<h1>Rapports hebdomadaires</h1>
<p><a href="./weekly-report.html">Dernier (latest)</a></p>
<ul>${links}</ul>`;
fs.writeFileSync(path.join("report", "index.html"), index);

console.log("Report written:", dated, "and latest:", latest);
