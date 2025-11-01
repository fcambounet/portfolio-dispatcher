import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function sha256(buf: Buffer | string) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function hashFile(p: string) {
  if (!fs.existsSync(p)) return null;
  return sha256(fs.readFileSync(p));
}
function isoDate(d = new Date()) { return new Date(d).toISOString().slice(0,10); }

export type AuditBlob = {
  asOf: string;
  git?: { sha?: string | null; ref?: string | null; runId?: string | null };
  inputs: {
    config?: { file: string; sha256: string | null };
    sectors: Array<{ file: string; sha256: string | null }>;
    quali: Array<{ file: string; sha256: string | null }>;
  };
  outputs: {
    target?: { file: string; sha256: string | null; sumWeight?: number };
    risk?: { file: string; sha256: string | null; status?: string };
  };
};

export function writeAudit(asOfISO: string) {
  const asOf = isoDate(asOfISO);
  const dir = path.join("data", "audit");
  fs.mkdirSync(dir, { recursive: true });

  const cfgFile = path.join("config", "portfolio.yml");
  // inputs
  const sectorsDir = path.join("data", "sectors");
  const qualiDir   = path.join("data", "research", "analysis");
  const sectorFiles = fs.existsSync(sectorsDir)
    ? fs.readdirSync(sectorsDir).filter(f => f.endsWith(".json")).map(f => path.join(sectorsDir, f))
    : [];
  const qualiFiles = fs.existsSync(qualiDir)
    ? fs.readdirSync(qualiDir).filter(f => f.endsWith(".json")).map(f => path.join(qualiDir, f))
    : [];

  // outputs
  const targetFile = path.join("data", "portfolio.target.json");
  const riskFile   = path.join("data", "portfolio.risk.json");

  let sumWeight: number | undefined = undefined;
  if (fs.existsSync(targetFile)) {
    try {
      const arr = JSON.parse(fs.readFileSync(targetFile, "utf8"));
      if (Array.isArray(arr)) sumWeight = Number(arr.reduce((a, b) => a + (b.weight || 0), 0).toFixed(6));
    } catch {}
  }

  let riskStatus: string | undefined = undefined;
  if (fs.existsSync(riskFile)) {
    try {
      const r = JSON.parse(fs.readFileSync(riskFile, "utf8"));
      riskStatus = r?.status;
    } catch {}
  }

  const blob: AuditBlob = {
    asOf,
    git: {
      sha: process.env.GITHUB_SHA || null,
      ref: process.env.GITHUB_REF || null,
      runId: process.env.GITHUB_RUN_ID || null,
    },
    inputs: {
      config: { file: cfgFile, sha256: hashFile(cfgFile) },
      sectors: sectorFiles.map(f => ({ file: f, sha256: hashFile(f) })),
      quali:   qualiFiles.map(f  => ({ file: f, sha256: hashFile(f) })),
    },
    outputs: {
      target: { file: targetFile, sha256: hashFile(targetFile), sumWeight },
      risk:   { file: riskFile,   sha256: hashFile(riskFile),   status: riskStatus },
    }
  };

  const outfile = path.join(dir, `${asOf}.json`);
  fs.writeFileSync(outfile, JSON.stringify(blob, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, `latest.json`), JSON.stringify(blob, null, 2), "utf8");
  return outfile;
}
