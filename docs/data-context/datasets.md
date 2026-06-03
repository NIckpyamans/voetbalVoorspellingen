# Datasetcatalogus

## Core Football Graph
| Dataset | Grain | Doel | Belangrijkste keys | Eigenaar |
| --- | --- | --- | --- | --- |
| `countries` | 1 rij per land | Landnormalisatie | `country_id` | Database |
| `competitions` | 1 rij per competitie | Competitie-identiteit | `competition_id`, `country_id` | Database |
| `competition_seasons` | 1 rij per competitie-seizoen | Seizoenstatus en archivering | `season_id`, `competition_id` | Archive |
| `clubs` | 1 rij per club | Clubidentiteit | `club_id`, `country_id`, `venue_id` | Validation |
| `club_aliases` | 1 rij per alias | Naamnormalisatie | `club_id`, `normalized_alias` | Validation |
| `venues` | 1 rij per stadion | Locatie en weercontext | `venue_id` | Data collection |

## Match Data
| Dataset | Grain | Doel | Belangrijkste keys | Eigenaar |
| --- | --- | --- | --- | --- |
| `matches` | 1 rij per wedstrijd | Fixture identiteit | `match_id`, `competition_id`, `season_id` | Worker |
| `match_results` | 1 rij per gespeelde wedstrijd | Eindstand/evaluatiebasis | `match_id` | Validation |
| `match_stats` | 1 rij per wedstrijd | Wedstrijdstatistieken | `match_id` | Data collection |
| `team_match_stats` | 1 rij per team per wedstrijd | Teamstatistieken per side | `match_id`, `side` | Data collection |
| `h2h_edges` | 1 rij per clubpaar/competitie | Onderlinge historie | `home_club_id`, `away_club_id`, `competition_id` | Validation |

## Season Intelligence
| Dataset | Grain | Doel | Belangrijkste keys | Eigenaar |
| --- | --- | --- | --- | --- |
| `standings_snapshots` | 1 rij per captured standing | Standen historiseren | `standings_snapshot_id` | Archive |
| `team_season_stats` | 1 rij per club per seizoen | Vorm en season stats | `season_id`, `club_id` | Data collection |
| `season_archives` | 1 rij per afgesloten seizoen | Immutable seizoenafsluiting | `archive_id`, `season_id` | Archive |

## Squad Context
| Dataset | Grain | Doel | Belangrijkste keys | Eigenaar |
| --- | --- | --- | --- | --- |
| `players` | 1 rij per speler | Selectiecontext | `player_id`, `club_id` | Data collection |
| `squads` | 1 rij per speler/club/seizoen | Beschikbare selectie | `squad_id`, `player_id`, `club_id`, `season_id` | Data collection |
| `injuries` | 1 rij per blessureperiode | Afwezigen | `injury_id`, `player_id` | Data validation |
| `suspensions` | 1 rij per schorsing | Afwezigen | `suspension_id`, `player_id` | Data validation |

## Prediction And Market Ledger
| Dataset | Grain | Doel | Belangrijkste keys | Eigenaar |
| --- | --- | --- | --- | --- |
| `prediction_snapshots` | 1 rij per voorspelling | Immutable pre-match snapshot | `prediction_id`, `match_id` | Prediction |
| `prediction_evaluations` | 1 rij per voorspelling na resultaat | Modelprestatie | `prediction_id`, `match_id` | Learning |
| `odds_snapshots` | 1 rij per odds capture | Odds/closing-line analyse | `odds_snapshot_id`, `prediction_id` | Market |
| `model_versions` | 1 rij per modelversie | Reproduceerbaarheid | `model_version_id` | Prediction |
| `calibration_profiles` | 1 rij per segment/model | League/phase kalibratie | `calibration_profile_id` | Learning |

## Source Lineage
| Dataset | Grain | Doel | Belangrijkste keys | Eigenaar |
| --- | --- | --- | --- | --- |
| `source_records` | 1 rij per bronpayload | Herleidbaarheid | `source_record_id` | Data collection |
| `source_audit` | 1 rij per veld/source link | Field-level vertrouwen | `source_audit_id` | Validation |
