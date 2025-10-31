import fetch from "node-fetch";

export type PricePoint = { time: number; close: number };
export type PriceSeries = { symbol: string; points: PricePoint[] };

export async function fetchDailyCloses(symbol: string, range: string = "1mo"): Promise<PriceSeries> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo fetch failed ${res.status}`);
  const data = await res.json();
  const r = data.chart.result?.[0];
  if (!r) throw new Error(`No chart data for ${symbol}`);
  const ts: number[] = r.timestamp;
  const closes: number[] = r.indicators.quote[0].close;
  const points = ts.map((t: number, i: number) => ({ time: t * 1000, close: closes[i] }));
  return { symbol, points };
}

export async function getLatestChangePct(symbol: string): Promise<{ symbol: string; last: number; changePct: number }> {
  const s = await fetchDailyCloses(symbol, "1mo");
  const closes = s.points.map(p => p.close).filter((x: number) => Number.isFinite(x));
  if (closes.length < 2) throw new Error(`Not enough data for ${symbol}`);
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const changePct = ((last - prev) / prev) * 100;
  return { symbol, last, changePct };
}

export function estimateVolatility(points: PricePoint[], window: number = 20): number {
  const closes = points.map(p => p.close).filter((x: number) => Number.isFinite(x));
  if (closes.length < 2) return 0;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i-1]) / closes[i-1]);
  const n = Math.min(rets.length, window);
  const slice = rets.slice(rets.length - n);
  const mean = slice.reduce((a, b) => a + b, 0) / n;
  const var_ = slice.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1 || 1);
  return Math.sqrt(var_);
}