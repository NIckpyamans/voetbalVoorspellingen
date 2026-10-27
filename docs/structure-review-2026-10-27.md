# Structuurbeoordeling 2026-10-27

Beoordeling van de opbouw van `voetbalVoorspellingen` na volledige inspectie, plus
wat in deze ronde is aangepast.

## Conclusie

De basis is goed — beter dan het verslag van eerder deze maand suggereerde. De
code is modulair opgebouwd (`scripts/worker/` bevat 60+ losse modules), er zijn
expliciete kwaliteitspoorten (`feature-publication-gate`,
`enrichment-publication-gate`, `daily-quality-gate`), voorspellingen worden
immutable vastgelegd (`shared/predictionSnapshotLedger.js`, met maandpartities),
en de CI (`pull-request-quality.yml`) draait typecheck, unit-tests, build,
archief-retentie, repo-size, regressies én e2e-tests per PR.

Twee eerdere P0-adviezen bleken al geïmplementeerd: kalibratie (Platt-schaling
via `probability-calibration.js`, toegepast in `server-worker.js`) en
shadow-evaluatie (`evaluate-shadow-predictions.js`). De gewichten worden
gedocumenteerd in `docs/data-weighting-policy.md`.

## Wat niet goed is

1. **Monoliet.** `scripts/server-worker.js` is ruim 9.700 regels; de
   voorspellingspijplijn hangt aan één bestand. `docs/worker-modularization-plan.md`
   beschrijft dit al als plan.
2. **Wedstrijdopslag zonder index.** `data/history-summary.json` is één
   multi-MB-JSON die per consument volledig wordt geparst; er was geen compacte,
   per-club raadpleegbare opslag. **In deze ronde opgelost** (zie hieronder).
3. **Productiedeploy was handmatig.** `deploy-production.yml` draaide alleen op
   `workflow_dispatch`, waardoor de live site elf dagen achterliep op de branch.
   **In deze ronde opgelost**: automatische deploy bij code-push, met
   `[skip vercel]`-bewaker.
4. **Zware data in git.** De repo is ruim 800 MB; `monitor:repository-size`
   bewaakt dit, maar `data/days/*.json` bevat per wedstrijd zware velden
   (volledige opstellingen met spelerslijsten, recentMatches met bronketens,
   featureSourceMetadata). Volgende stap: dagbestanden compacter wegschrijven.
5. **Versnipperde compactielogica.** Veldlijsten en weggooi-keuzes zitten
   verspreid over `archive.js`, `training-recovery.js`, `training-snapshot.js`
   en `compact-history-summary.js`. Eén gedeelde compactie-laag zou misverstanden
   voorkomen.

## Wat deze ronde is veranderd

- `shared/matchStore.js` — compacte wedstrijdrecords (korte veldnamen, alleen
  lookup- en auditvelden), index per club/duel/datum en O(1)-lookups
  (`queryTeamMatches`, `queryPairMatches`) plus clubaggregatie.
- `tests/unit/match-store.test.js` — dekt bouwen, dedup, lookups, aggregatie en
  serialisatie; draait mee in `pull-request-quality.yml`.
- `scripts/build-match-store.js` + `.github/workflows/match-store.yml` — houden
  `data/match-store.json` en `data/match-index.json` automatisch actueel.
  Uitvoer is minified en deterministisch.
- `scripts/club-analysis.js` — werkt nu op de store: één parse voor alle clubs in
  plaats van het multi-MB-bestand per analyse te doorlopen.
- `scripts/compact-history-summary.js` — schrijft minified uitvoer.
- `.github/workflows/deploy-production.yml` — automatische productiedeploy bij
  code-push naar `codex/step3b-layout` (data/docs-pushes overslaan).

## Openstaand voor de volgende ronde

- Dagbestanden afslanken (opstellingen en recentMatches compacter archiveren).
- `server-worker.js` modulariseren volgens het bestaande plan.
- Marktbaseline-rapport per competitie (model vs. de-vig markt) toevoegen.
- Lege invoerbronnen vullen via de bestaande enrichment-workflows
  (H2H 6%, bevestigde opstellingen 0%, xG 0%).
