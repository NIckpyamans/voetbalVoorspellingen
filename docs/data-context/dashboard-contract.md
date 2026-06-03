# Dashboardcontract

## Dashboardsecties
| Sectie | Doel | Primaire datasets | Minimale status |
| --- | --- | --- | --- |
| Wedstrijdanalyse | Voorspelling, kansen, score, uitleg | `matches`, `prediction_snapshots`, `match_stats`, `h2h_edges` | `data_completeness_score >= 0.58` |
| Teamanalyse | Vorm, thuis/uit, xG, selectie | `team_season_stats`, `team_match_stats`, `injuries`, `suspensions` | Vorm >= 5 wedstrijden of duidelijke fallback |
| Competitieanalyse | Stand, fase, betrouwbaarheid | `competitions`, `competition_seasons`, `standings_snapshots` | Actuele standings snapshot |
| Modelprestaties | Hit rates, Brier, calibration | `prediction_evaluations`, `model_versions`, `calibration_profiles` | Minimaal 50 snapshot-backed evaluations |
| Marktanalyse | Odds, CLV, ROI | `odds_snapshots`, `prediction_evaluations` | Echte odds key + database actief |
| Datakwaliteit | H2H, scores, source gaps | `source_audit`, `source_records`, monitor audits | Iedere worker-run |

## UI-regels
- Toon ROI/CLV alleen als `oddsClosingLine.roiClvReady = true`.
- Toon database status expliciet als `database.connectionConfigured = false`.
- Toon confidence-caps in de uitleg wanneer quality gate confidence beperkt.
- Toon bronherkomst naast modeluitleg: H2H, xG, standings, odds en lineups.
- Toon lege speeldagen alleen als fixture calendar `healthy` of `confirmed_empty_with_gap_note` is.

## Analysevragen
- Welke competities hebben structureel lagere H2H-dekking?
- Welke databron veroorzaakt de meeste scoreconflicten?
- Welke modelversie verlaagt Brier score per league/phase?
- Welke factoren drijven top-confidence picks?
- Waar wijkt exact-score selectie af van 1X2-dominant outcome?
- Hoeveel predictions zijn volledig leak-proof met immutable snapshot?
