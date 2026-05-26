# Prediction data model

Doel: elke voorspelling later exact kunnen reconstrueren, evalueren en gebruiken als trainingsdata zonder data leakage.

## Tabellen

### `matches`

| Kolom | Type | Opmerking |
| --- | --- | --- |
| `match_id` | text primary key | Interne match-id, bijvoorbeeld `ss-...` |
| `source_match_id` | text | Externe provider-id |
| `data_source` | text | Sofascore, ESPN, fallback, enzovoort |
| `league` | text | Competitie |
| `season` | text | Seizoen indien bekend |
| `kickoff_at` | timestamptz | Aftraptijd |
| `home_team_id` | text | Provider team-id, nullable |
| `away_team_id` | text | Provider team-id, nullable |
| `home_team_name` | text | Teamnaam op voorspellingstijdstip |
| `away_team_name` | text | Teamnaam op voorspellingstijdstip |
| `team_identity` | jsonb | Provider-id plus naam-fallback keys |
| `status` | text | PRE, LIVE, FT, enzovoort |

### `prediction_snapshots`

| Kolom | Type | Opmerking |
| --- | --- | --- |
| `prediction_id` | text primary key | Immutable snapshot-id |
| `match_id` | text references matches | Matchkoppeling |
| `generated_at` | timestamptz | Exacte voorspellingstijd |
| `cutoff_at` | timestamptz | Laatste toegestane inputtijd |
| `model_version` | text | Bijvoorbeeld `v23-calibrated-odds-ledger` |
| `feature_schema_version` | text | Feature schema |
| `algorithm_version` | text | Basismodel/ensemble |
| `input_snapshot_hash` | text | Hash voor reconstructie |
| `input_snapshot` | jsonb | Alle gebruikte inputdata |
| `features` | jsonb | Feature vector |
| `probabilities` | jsonb | 1X2-kansen |
| `confidence` | numeric | Gekalibreerde confidence |
| `confidence_raw` | numeric | Confidence voor kalibratie |
| `calibration` | jsonb | Probability/confidence correcties |
| `expected_score` | jsonb | Verwachte score |
| `explanation` | jsonb | Modelranden/uitleg |
| `data_completeness` | jsonb | Missing data en score |
| `feature_source_metadata` | jsonb | As-of/source audit |
| `leakage_guard` | jsonb | Cutoff/leakage controle |

### `odds_snapshots`

| Kolom | Type | Opmerking |
| --- | --- | --- |
| `odds_snapshot_id` | text primary key | Hash of provider-id |
| `prediction_id` | text references prediction_snapshots | Pre-match odds bij voorspelling |
| `provider` | text | Oddsprovider |
| `bookmaker` | text | Bookmaker/exchange |
| `market` | text | `1X2` |
| `home` | numeric | Decimal odds thuis |
| `draw` | numeric | Decimal odds gelijk |
| `away` | numeric | Decimal odds uit |
| `captured_at` | timestamptz | Moet <= cutoff/kickoff zijn |
| `closing_home` | numeric | Closing odds thuis |
| `closing_draw` | numeric | Closing odds gelijk |
| `closing_away` | numeric | Closing odds uit |
| `closing_captured_at` | timestamptz | Na market close |

### `match_results`

| Kolom | Type | Opmerking |
| --- | --- | --- |
| `match_id` | text primary key references matches | Match |
| `final_home_goals` | integer | FT goals thuis |
| `final_away_goals` | integer | FT goals uit |
| `actual_outcome` | text | H/D/A |
| `result_source` | text | Bron |
| `settled_at` | timestamptz | Moment van evaluatie |

### `prediction_evaluations`

| Kolom | Type | Opmerking |
| --- | --- | --- |
| `prediction_id` | text primary key references prediction_snapshots | Snapshot |
| `match_id` | text references matches | Match |
| `exact_hit` | boolean | Exacte score goed |
| `outcome_hit` | boolean | Verwachte score-uitkomst goed |
| `probability_outcome_hit` | boolean | Hoogste 1X2-kans goed |
| `brier_score` | numeric | 1X2 Brier |
| `log_loss` | numeric | 1X2 log loss |
| `roi` | numeric | Alleen met echte odds |
| `clv` | numeric | Alleen met pre-match en closing odds |
| `evaluation_source` | text | Snapshot of fallback |
| `evaluated_at` | timestamptz | Evaluatiemoment |

### `source_audit`

| Kolom | Type | Opmerking |
| --- | --- | --- |
| `prediction_id` | text references prediction_snapshots | Snapshot |
| `field_name` | text | Bijvoorbeeld `form`, `xgShots`, `oddsAtPrediction` |
| `available` | boolean | Aanwezig |
| `source` | text | Bron |
| `as_of` | timestamptz | Bron- of cachetimestamp |
| `source_timestamp_known` | boolean | Volledig bekend |
| `note` | text | Auditnotitie |

## Indexen

- `prediction_snapshots(match_id, generated_at desc)`
- `prediction_snapshots(model_version, generated_at desc)`
- `prediction_evaluations(evaluated_at desc)`
- `prediction_evaluations(model_version)` als `model_version` gedupliceerd wordt voor snelle BI
- `odds_snapshots(prediction_id)`
- `source_audit(prediction_id, field_name)`

## Leakage-regels

- `generated_at <= kickoff_at` voor pre-match snapshots.
- `cutoff_at <= kickoff_at`.
- `odds_snapshots.captured_at <= prediction_snapshots.cutoff_at`.
- Reviews zonder `prediction_id` blijven bruikbaar als historische fallback, maar niet als volledig lekvrije trainingsdata.
