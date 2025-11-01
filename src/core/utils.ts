// src/core/utils.ts

/** Retourne une date ISO sans millisecondes (ex: 2025-11-01T13:45:00Z) */
export function nowISO(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Retourne uniquement la date YYYY-MM-DD */
export function isoDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Retourne un timestamp lisible ex: 2025-11-01 13:45 */
export function prettyNow(): string {
  const d = new Date();
  return d.toISOString().replace("T", " ").slice(0, 16);
}

/** Formatte un nombre en pourcentage (2 décimales, suffixe %) */
export function fmtPct(v: number, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return `${(v * 100).toFixed(digits)}%`;
}

/** Arrondit un nombre à n décimales */
export function round(v: number, n = 2): number {
  const f = Math.pow(10, n);
  return Math.round(v * f) / f;
}

/** Somme des poids d’un portefeuille */
export function sumWeights(target: Array<{ weight: number }>): number {
  return round(target.reduce((a, b) => a + (b.weight || 0), 0), 6);
}

/** Journalise proprement avec timestamp et couleur */
export function logInfo(msg: string) {
  console.log(`\x1b[36m[INFO ${prettyNow()}]\x1b[0m ${msg}`);
}

export function logWarn(msg: string) {
  console.warn(`\x1b[33m[WARN ${prettyNow()}]\x1b[0m ${msg}`);
}

export function logErr(msg: string) {
  console.error(`\x1b[31m[ERR  ${prettyNow()}]\x1b[0m ${msg}`);
}
