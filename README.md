<<<<<<< HEAD
# portfolio-agents (starter compatible)

Stack alignée avec ton autre projet : **Node 18 + TypeScript 5 + npm + tsx + GitHub Actions + Cloudflare Worker**.

## Démarrer
```bash
npm install
npm run dev              # lance le pipeline hebdo local (JSONL dans data/)
```

## Cloudflare Worker
```bash
npm run worker:dev
npm run worker:deploy
```
Configurer les secrets via `wrangler secret put` (WEBHOOK_SECRET, GITHUB_TOKEN).

## Structure
- `src/agents` : agents (Analyste Sectoriel, Recommandateur Sectoriel…)
- `src/jobs/weekly.ts` : pipeline hebdo (MVP)
- `configs/*.yaml` : secteurs, contraintes, planning
- `data/*.jsonl` : artefacts et logs append-only
- `worker/` : dispatcher façon “autre projet”
- `.github/workflows/agent-router.yml` : déclenche le pipeline quand la PR a le label `run:portfolio`

## Étapes suivantes (optionnelles, sans changer d'outils)
- Remplacer JSONL par SQLite (`better-sqlite3`)
- Ajouter ESLint/Prettier + Vitest
- Connecteurs marché & scoring
- Agents supplémentaires (IR, SP, RM, EXE, CQA)
=======
# portfolio-dispatcher
Cabinet d'investissement
>>>>>>> 7d0ef255fe021cfbebe1794232a8d57b05a0b4f8

