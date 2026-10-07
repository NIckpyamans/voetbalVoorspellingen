# Weegbeleid voor historische data en modelsignalen

Dit document beschrijft hoe zwaar elke databron meeweegt in een voorspelling, en
waarom de gewichten in oktober 2026 zijn bijgesteld. De aanleiding is de
geregistreerde reviewdiagnose in `data/meta.json`
(`featureDiagnostics.topFailureSignals`) over 1742 beoordeelde wedstrijden:

| Faalsignaal | Keer mis | Wat het betekent |
| --- | --- | --- |
| `low_model_agreement` | 390 | submodellen lagen te ver uit elkaar (penalty bestaat al) |
| `open_lineups` | 314 | opstelling was nog niet bevestigd |
| `market_misread` | 274 | markt-overperformance-feature gaf de verkeerde richting |
| `h2h_signal` | 273 | H2H met >= 3 duels gaf de verkeerde richting |
| `rest_gap` | 156 | rustverschil gaf de verkeerde richting |
| `clubelo_misread` | 141 | grote ClubElo/sterktesprong gaf de verkeerde richting |

Signalen worden alleen geteld wanneer de voorspelling fout was, dus een hoog
aantal betekent: dit signaal was vaak de aanleiding van een misser.

## 1. Historische wedstrijden: recency en competitieniveau

Twee assen bepalen hoe zwaar een afgerond duel meeweegt.

| As | Regel | Waarom |
| --- | --- | --- |
| Recency (team-learning) | halfwaardetijd **90 dagen** (was 120) | de vorm van deze maanden zegt meer dan die van vorig seizoen |
| Recency (vorm-kopstatistieken) | halfwaardetijd **3 duels** (was vlak over 10) | de laatste weken voorspellen het best; `last5`/`last10`/`last20` blijven vlak voor vergelijkbaarheid |
| Competitieduel | gewicht **1.0** | standaard referentie |
| Beker / knockout / play-off / kwalificatie | gewicht **0.7** (was 1.0) | rotatie en tweeluiken maken deze duels ruiziger |
| Oefenduel | gewicht **0.15** (was 0.35) | friendlies zijn nauwelijks voorspellend; de reviewdata laat geen betrouwbare treffer zien |

Implementatie: `scripts/worker/local-team-form-history.js`
(`competitionWeight`, `HEADLINE_RECENCY_HALF_LIFE`) en
`scripts/worker/weighted-learning.js` (`WEIGHTED_LEARNING_POLICY`).

## 2. Ensemblegewichten (1X2)

`scripts/worker/outcome-ensemble.js` (`OUTCOME_ENSEMBLE_WEIGHTS`):

| Component | Gewicht | Was | Onderbouwing |
| --- | --- | --- | --- |
| `dixon_coles_poisson` | 0.37 | 0.34 | meest stabiele onderdeel (doelpuntenmodel) |
| `feature_score_model` | 0.22 | 0.22 | gelijk |
| `monte_carlo` | 0.14 | 0.14 | gelijk |
| `club_elo` | 0.05 | 0.10 | `clubelo_misread` 141x; de Elo-component is een expliciete heuristiek, geen backtest |
| `de_vig_market` | 0.16 | 0.15 | gede-vigde consensus is het sterkste signaal zodra er pre-kickoff odds zijn |
| `confirmed_lineup` | 0.05 | 0.05 | gelijk |
| `squad_strength` | 0.12 | 0.12 | gelijk |
| `two_leg_context` | 0.05 | 0.05 | gelijk |
| `gradient_boosting` | 0.20 | 0.20 | gelijk; blijft inactief zonder gepromoveerd model |

Ontbrekende componenten worden automatisch gehernormaliseerd: zonder
markt/boosting stijgt het aandeel van het doelpuntenmodel.

## 3. Feature-heuristiek (`scripts/server-worker.js`)

| Feature | Was | Nu | Onderbouwing |
| --- | --- | --- | --- |
| `club_elo_diff` | onbegrensd, coëfficiënt 0.18 | afgetopt op ±120 Elo, coëfficiënt 0.15 | `clubelo_misread` 141x |
| `market_overperformance_diff` | 0.10 | `MARKET_OVERPERFORMANCE_WEIGHT` = 0.06 | `market_misread` 274x |
| `rest_diff` | 0.08 | `REST_DIFF_WEIGHT` = 0.05 | `rest_gap` 156x |
| `h2h_balance` | 0.05 x reliability, altijd | 0.04 x reliability, alleen bij reliability >= 0.5 | `h2h_signal` 273x |
| `h2h_recent_5_balance` | 0.12 x reliability, altijd | 0.09 x reliability, alleen bij reliability >= 0.5 én >= 3 duels | `h2h_signal` 273x |

## 4. Validatie

- Unit/contracttests pinnen deze gewichten: `tests/unit/outcome-ensemble.test.js`,
  `tests/unit/learning-cycle.test.js`, `tests/unit/local-team-form-history.test.js`.
- Deze herweging is een **hypothese op basis van de geregistreerde
  faalsignalen**, geen bewezen nauwkeurigheidswinst. De shadow-evaluatie
  (`nightly-model-maintenance` / `scripts/evaluate-shadow-predictions.js`) moet
  per component laten zien of Brier, logLoss en hitrate werkelijk verbeteren
  voordat een verdergaande stap wordt gezet.
- Historische voorspellingen blijven immutable; er worden geen oude snapshots
  herschreven.
