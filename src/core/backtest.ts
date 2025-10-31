import fs from "node:fs";
import path from "node:path";

type TargetLine = { symbol: string; weight: number };
type Positions = Record<string, number>;

const LEDGER_DIR = path.join("data", "ledger");
const POS_FILE = path.join(LEDGER_DIR, "positions.json");
const NAV_CSV  = path.join(LEDGER_DIR, "nav.csv");
const TRD_CSV  = path.join(LEDGER_DIR, "trades.csv");

// —————— utils ——————
function ensureDir() { fs.mkdirSync(LEDGER_DIR, { recursive: true }); }
function iso(d = new Date()) { return new Date(d).toISOString().slice(0,10); }
function readJSON<T>(p: string, fallback: T): T {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,"utf8")); } catch {}
  return fallback;
}
function writeJSON(p: string, data: any) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}
function readSeries(symbol: string): number[] {
  const p = path.join("data", `series_${symbol}.json`);
  try {
    if (!fs.existsSync(p)) return [];
    const arr = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(arr) ? arr.filter((x: any) => Number.isFinite(x)) : [];
  } catch { return []; }
}
function latestPrice(symbol: string): number | null {
  const arr = readSeries(symbol);
  if (!arr.length) return null;
  return Number(arr[arr.length - 1]) || null;
}
function appendCSV(p: string, header: string, row: string) {
  if (!fs.existsSync(p)) fs.writeFileSync(p, header + "\n", "utf8");
  fs.appendFileSync(p, row + "\n", "utf8");
}

// —————— API ——————
/** Crée le ledger si absent. Montant initial en cash, NAV=100 baseline benchmark=100 */
export async function initLedger(initialCash = 10000, asOf?: string) {
  ensureDir();
  if (!fs.existsSync(POS_FILE)) writeJSON(POS_FILE, {} as Positions);
  if (!fs.existsSync(NAV_CSV)) {
    const d = asOf || iso();
    appendCSV(NAV_CSV, "date,nav,cash,value,benchmark", `${d},${initialCash.toFixed(2)},${initialCash.toFixed(2)},0,100`);
  }
  if (!fs.existsSync(TRD_CSV)) appendCSV(TRD_CSV, "date,symbol,qty,price,value,reason", "");
}

/** Évalue la valeur du portefeuille (positions + cash) au dernier prix connu. */
export async function markToMarket(asOf?: string) {
  ensureDir();
  const d = asOf || iso();
  const pos: Positions = readJSON(POS_FILE, {});
  // Cash est suivi via le dernier enregistrement de nav.csv
  let cash = 0;
  if (fs.existsSync(NAV_CSV)) {
    const lines = fs.readFileSync(NAV_CSV,"utf8").trim().split("\n");
    const last = lines[lines.length-1]?.split(",");
    if (last && last.length >= 3) cash = Number(last[2]) || 0;
  }
  let value = 0;
  for (const [sym, qty] of Object.entries(pos)) {
    const px = latestPrice(sym) ?? 0;
    value += qty * px;
  }

  // Benchmark simple : utilise SPY si dispo, sinon 100 constant
  const benchSeries = readSeries("SPY");
  const benchmark = benchSeries.length ? (benchSeries[benchSeries.length-1] / benchSeries[0]) * 100 : 100;

  const nav = cash + value;
  // Note: on n’écrit pas dans le CSV ici (écriture après rebalance)
  return { date: d, nav, cash, value, benchmark };
}

/** Rebalance vers les weights cibles (quantités fractionnaires autorisées). */
export async function rebalance(target: TargetLine[], asOf?: string) {
  ensureDir();
  const d = asOf || iso();
  const pos: Positions = readJSON(POS_FILE, {});
  // Lire dernier cash depuis nav.csv
  let cash = 0;
  if (fs.existsSync(NAV_CSV)) {
    const lines = fs.readFileSync(NAV_CSV,"utf8").trim().split("\n");
    const last = lines[lines.length-1]?.split(",");
    if (last && last.length >= 3) cash = Number(last[2]) || 0;
  }

  // Valeur portefeuille au marché (avant trades)
  let value = 0;
  for (const [sym, qty] of Object.entries(pos)) {
    const px = latestPrice(sym) ?? 0;
    value += qty * px;
  }
  const equity = cash + value;
  if (equity <= 0) return [];

  // Désirs par symbole
  const desires: Record<string, number> = {};
  for (const t of target) {
    const px = latestPrice(t.symbol);
    if (px == null || px <= 0) continue;
    const targetValue = equity * t.weight;
    desires[t.symbol] = targetValue / px; // quantité souhaitée
  }

  // Crée aussi des ordres pour fermer les positions non désirées
  for (const held of Object.keys(pos)) {
    if (!(held in desires)) desires[held] = 0;
  }

  const trades: { date: string; symbol: string; qty: number; price: number; value: number; reason: string }[] = [];
  for (const [sym, desiredQty] of Object.entries(desires)) {
    const current = pos[sym] || 0;
    const delta = desiredQty - current;
    if (Math.abs(delta) < 1e-6) continue; // negligible
    const px = latestPrice(sym) ?? 0;
    const tradeValue = delta * px;
    // Exécute l’ordre
    pos[sym] = current + delta;
    cash -= tradeValue; // achat -> cash baisse ; vente -> cash augmente
    trades.push({ date: d, symbol: sym, qty: delta, price: px, value: tradeValue, reason: "rebalance" });
  }

  // Sauvegarde positions & trades
  writeJSON(POS_FILE, pos);
  for (const t of trades) {
    appendCSV(TRD_CSV, "date,symbol,qty,price,value,reason",
      `${t.date},${t.symbol},${t.qty.toFixed(6)},${t.price.toFixed(4)},${t.value.toFixed(2)},${t.reason}`);
  }

  // Écrit la nouvelle ligne de NAV
  // Recalcule la valeur après exécution
  let newValue = 0;
  for (const [sym, qty] of Object.entries(pos)) {
    const px = latestPrice(sym) ?? 0;
    newValue += qty * px;
  }
  const nav = cash + newValue;

  // Benchmark (même logique que markToMarket)
  const benchSeries = readSeries("SPY");
  const benchmark = benchSeries.length ? (benchSeries[benchSeries.length-1] / benchSeries[0]) * 100 : 100;

  appendCSV(NAV_CSV, "date,nav,cash,value,benchmark",
    `${d},${nav.toFixed(2)},${cash.toFixed(2)},${newValue.toFixed(2)},${benchmark.toFixed(2)}`);

  return trades;
}
