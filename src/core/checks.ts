export type CheckIssue = { code: string; severity: "WARN"|"ERROR"; message: string };
export type ChecksResult = { ok: boolean; issues: CheckIssue[]; summary: Record<string, any> };

export function runChecks(params: {
  target: Array<{ symbol: string; weight: number }>;
  constraints: { maxLine: number; maxSector: number };
  minLines?: number;
  tol?: number; // tolérance sur la somme des poids (ex 1e-6)
}): ChecksResult {
  const { target, constraints, minLines = 4, tol = 1e-6 } = params;
  const issues: CheckIssue[] = [];
  const n = target.length;

  // 1) somme des poids ≈ 1.0
  const sum = Number(target.reduce((a, b) => a + (b.weight || 0), 0).toFixed(6));
  if (Math.abs(sum - 1) > tol) {
    issues.push({ code: "SUM_WEIGHTS", severity: "ERROR", message: `Sum of weights = ${sum} (≠ 1)` });
  }

  // 2) aucun poids négatif
  const neg = target.filter(t => t.weight < -tol);
  if (neg.length) {
    issues.push({ code: "NEGATIVE_WEIGHT", severity: "ERROR", message: `Negative weights found (${neg.length})` });
  }

  // 3) cap par ligne
  const overLine = target.filter(t => t.weight > constraints.maxLine + tol);
  if (overLine.length) {
    issues.push({ code: "MAX_LINE", severity: "ERROR", message: `Lines over maxLine (${constraints.maxLine}) : ${overLine.map(x=>x.symbol).join(", ")}` });
  }

  // 4) min de lignes
  if (n < minLines) {
    issues.push({ code: "MIN_LINES", severity: "WARN", message: `Only ${n} lines (< ${minLines})` });
  }

  // 5) trous / NaN
  const bad = target.filter(t => !Number.isFinite(t.weight));
  if (bad.length) issues.push({ code: "NAN_WEIGHT", severity: "ERROR", message: `Non-finite weights (${bad.length})` });

  const ok = issues.every(i => i.severity !== "ERROR");
  return { ok, issues, summary: { sum, n } };
}
