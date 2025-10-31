Ajouts "palier réaliste":
- `src/core/finance.ts` : fetch Yahoo Finance (closes, % change, volatilité simple).
- `src/agents/recommandateur-sectoriel.ts` : utilise les quotes pour classer les picks.
- `src/agents/strategiste-portefeuille.ts` : construit une allocation cible sous contraintes simples.
- `src/agents/risk-manager.ts` : vérifie des limites de base.
- `src/jobs/weekly.ts` : génère `data/weekly-summary.json` et `data/portfolio.target.json`.