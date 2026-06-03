# KPI-definities

## Datakwaliteit
| KPI | Definitie | Doelwaarde | Bron |
| --- | --- | --- | --- |
| `h2h_coverage` | Wedstrijden met bruikbaar H2H-profiel gedeeld door totaal | >= 85% | `monitor/data-quality-audit.json`, `h2h_edges` |
| `pending_result_backfills` | Afgeronde wedstrijden zonder betrouwbare eindstand | 0 | `match_results`, data-quality audit |
| `missing_past_scores` | Oude wedstrijden zonder score | 0 | `match_results` |
| `source_reliability_score` | Gewogen betrouwbaarheid van brondata per voorspelling | >= 0.62 | `prediction_snapshots.explanation.sourceReliability` |
| `data_completeness_score` | Completeness-score voor H2H, vorm, xG, odds, lineups en standings | >= 0.70 top picks | `prediction_snapshots.data_completeness` |

## Modelkwaliteit
| KPI | Definitie | Doelwaarde | Bron |
| --- | --- | --- | --- |
| `outcome_hit_rate` | Voorspelde score-uitkomst correct | Trend omhoog | `prediction_evaluations` |
| `probability_outcome_hit_rate` | Hoogste 1X2-kans correct | Trend omhoog | `prediction_evaluations` |
| `exact_hit_rate` | Exacte score correct | Segmentbenchmark | `prediction_evaluations` |
| `brier_score` | 1X2 probabilistische foutscore, lager is beter | Dalen per modelversie | `prediction_evaluations` |
| `log_loss` | Straf voor overzekere verkeerde voorspellingen | Dalen per modelversie | `prediction_evaluations` |
| `calibration_error` | Afwijking tussen voorspelde kans en werkelijke frequentie | < 0.08 per segment | `calibration_profiles` |

## Marktkwaliteit
| KPI | Definitie | Doelwaarde | Bron |
| --- | --- | --- | --- |
| `odds_capture_rate` | Predictions met echte pre-match odds | >= 80% zodra odds live staan | `odds_snapshots` |
| `closing_line_coverage` | Odds snapshots met closing odds | >= 70% | `odds_snapshots` |
| `clv` | Closing line value per selectie | Positieve trend | `prediction_evaluations` |
| `roi` | Winst/verlies op selectiebeleid | Alleen tonen met echte odds | `prediction_evaluations` |

## Platformgezondheid
| KPI | Definitie | Doelwaarde | Bron |
| --- | --- | --- | --- |
| `worker_age_minutes` | Minuten sinds laatste worker-run | <= 180 | `data/meta.json` |
| `fixture_calendar_status` | Is lege kalender verklaard door bronnen | `healthy` | `shared/fixtureCalendar.js` |
| `snapshot_backed_rows` | Training rows met prediction snapshot | >= 150 volgend doel | `training/catboost-ready.json` |
