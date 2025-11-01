import https from "node:https";

export async function fetchCSV(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, res2 => {
          let data = ""; res2.on("data", c => data += c); res2.on("end", () => resolve(data));
        }).on("error", reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = ""; res.on("data", c => data += c); res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

export async function stooqSeries(symbol: string): Promise<number[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}&i=d`;
  const csv = await fetchCSV(url);
  const lines = csv.trim().split(/\r?\n/).slice(1);
  const closes = lines.map(l => Number(l.split(",")[4])).filter(Number.isFinite);
  if (!closes.length) return [];
  const base = closes[0] || 1;
  return closes.map(x => (x / base) * 100);
}
