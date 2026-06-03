# Worker Modules

Deze map is de veilige opsplitsing van `scripts/server-worker.js`.

## Modules
- `data-collection.js`: publieke bronnen, fetch timeouts, rate-limit circuits, retries en source diagnostics.
- `validation.js`: matchstatus, score parsing, result backfill, H2H-contracten en bronconflicten.
- `prediction.js`: pure prediction math, Poisson helpers, scorematrix, ensemble en probability calibration.
- `learning.js`: post-match reviews, modelmetingen, team learning en calibration profiles.
- `archive.js`: JSON split-output, meta-export en competition archive writes.

## Extractieregels
- Verplaats alleen pure of contractueel afgebakende functies.
- Geen modelgewichten aanpassen tijdens modularisatie.
- Geen nieuwe databronnen toevoegen tijdens extractie.
- Elke extract moet `npm run check`, `npm run monitor:regressions`, `npm run readiness` en `npm run build` halen.
- `server_data.json` en `data/*.json` moeten dezelfde contracten blijven houden.
