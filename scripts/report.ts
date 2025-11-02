// scripts/report.ts
// Génère report/index.html avec noms d'entreprises (config/company-names.yml)

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

type TargetLine = { symbol: string; weight: number };
type SectorSummary = { sector: string; top: string[] };
type WeeklySummary = {
  asOf?: string;
  target?: TargetLine[];
  risk?: { riskStatus?: string };
  sectors?: SectorSummary[];
};

function readJSON<T = any>(p: string, fb: T): T {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {}
  return fb;
}

function readYAML<T = any>(p: string, fb: T): T {
  try {
    if (fs.existsSync(p)) return yaml.load(fs.readFileSync(p, "utf8")) as T;
  } catch {}
  return fb;
}

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

function pct(w: number, digits = 2): string {
  if (w === undefined || w === null || Number.isNaN(w)) return "–";
  return `${(w * 100).toFixed(digits)}%`;
}

/** Retourne le nom d’entreprise depuis company-names.yml ; fallback = symbole */
function nameFor(sym: string, map: Record<string, string>): string {
  const u = (sym || "").toUpperCase();
  return map[u] || sym;
}

/** Extrait le symbole d’une chaîne “SYM (PickScore=1.0)” */
function firstToken(s: string): string {
  const tok = (s || "").trim().split(/\s+/)[0] || "";
  return tok.replace(/[,\.;:]$/, "");
}

function htmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderTableRows(target: TargetLine[], nameMap: Record<string, string>) {
  return target
    .map((t) => {
      const sym = t.symbol;
      const nm = nameFor(sym, nameMap);
      return `<tr>
  <td><code>${htmlEscape(sym)}</code></td>
  <td>${htmlEscape(nm)}</td>
  <td style="text-align:right">${pct(t.weight)}</td>
</tr>`;
    })
    .join("\n");
}

function renderSectors(sectors: SectorSummary[], nameMap: Record<string, string>) {
  return sectors
    .map((s) => {
      const picks = Array.isArray(s.top) ? s.top : [];
      const items = picks
        .map((p) => {
          const sym = firstToken(p);
          const nm = nameFor(sym, nameMap);
          return `<li><code>${htmlEscape(sym)}</code> — ${htmlEscape(nm)}</li>`;
        })
        .join("\n");
      return `<section class="card sector">
  <h3>${htmlEscape(s.sector || "Secteur")}</h3>
  <ul>${items || "<li>Aucun</li>"}</ul>
</section>`;
    })
    .join("\n");
}

function providerBadge(): string {
  // Affiche la source des prix d’après config/portfolio.yml
  const cfg = readYAML<any>(path.join("config", "portfolio.yml"), {});
  const src = (cfg?.market?.source || "mixed").toLowerCase();
  if (src === "yahoo") return "Prix: Yahoo";
  if (src === "stooq") return "Prix: Stooq";
  // mixed = Yahoo (actions) + Stooq (indices)
  return "Prix: Yahoo (actions) • Stooq (indices)";
}

async function main() {
  ensureDir("report");

  const summary = readJSON<WeeklySummary>(path.join("data", "weekly-summary.json"), {});
  const target = readJSON<TargetLine[]>(path.join("data", "portfolio.target.json"), []);
  const namesCfg = readYAML<any>(path.join("config", "company-names.yml"), {});
  const nameMap: Record<string, string> = namesCfg?.map || {};

  const asOf = summary?.asOf || new Date().toISOString();
  const risk = summary?.risk?.riskStatus || "UNKNOWN";
  const sectors = Array.isArray(summary?.sectors) ? summary!.sectors! : [];

  const totalW = target.reduce((a, b) => a + (b.weight || 0), 0);
  const rows = renderTableRows(target, nameMap);
  const sectorsHtml = renderSectors(sectors, nameMap);
  const priceBadge = providerBadge();

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Rapport hebdomadaire — Portefeuille</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 22px; margin: 0 0 8px 0; }
  h2 { font-size: 18px; margin: 0 0 8px 0; }
  .meta { color:#555; margin-bottom: 16px; display:flex; flex-wrap: wrap; gap:8px; align-items:center; }
  .pill { display:inline-block; padding:4px 8px; border-radius:999px; background:#f2f2f2; margin-right:8px; font-size:12px; }
  .card { border:1px solid #eee; border-radius:12px; padding:12px; margin-top: 16px; background:#fff; }
  table { width:100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border-bottom: 1px solid #eee; padding: 8px; }
  th { text-align:left; background:#fafafa; }
  td:last-child, th:last-child { text-align:right; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap: 16px; margin-top: 16px; }
  code { background:#f6f8fa; padding:2px 6px; border-radius:6px; }
  .muted { color:#777; }
</style>
</head>
<body>
  <h1>Rapport hebdomadaire</h1>
  <div class="meta">
    <span class="pill">Risque: <strong>${htmlEscape(risk)}</strong></span>
    <span class="pill">Poids totaux: ${(totalW * 100).toFixed(2)}%</span>
    <span class="pill">${htmlEscape(priceBadge)}</span>
    <span class="muted">Généré: ${htmlEscape(asOf)}</span>
  </div>

  <section class="card">
    <h2>Allocation cible</h2>
    <table>
      <thead>
        <tr><th>Symbole</th><th>Entreprise</th><th>Poids</th></tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="3" style="text-align:center;color:#777">Aucune ligne</td></tr>'}
      </tbody>
    </table>
  </section>

  <section class="grid">
    ${sectorsHtml}
  </section>
</body>
</html>`;

  fs.writeFileSync(path.join("report", "index.html"), html, "utf8");
  console.log("📝 report/index.html écrit avec noms d’entreprises.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
