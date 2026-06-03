# Database Migratieplan

Laatst bijgewerkt: 2026-06-03T07:55:16.511Z

## Doel
Maak Postgres/Supabase de bron van waarheid voor een schaalbaar voetbal intelligence platform. JSON blijft alleen cache, export of fallback.

## Fase 1 - Fundament
- Maak tabellen voor countries, competitions, competition_seasons, clubs, club_aliases, venues en matches.
- Voeg source_records toe voor ruwe bronpayloads met provider, fetched_at, source_url, content_hash en trust_score.
- Voeg source_audit toe per genormaliseerd veld zodat iedere voorspelling herleidbaar blijft.

## Fase 2 - Wedstrijddata
- Breid matches uit met season_id, competition_id, home_club_id, away_club_id en status_normalized.
- Maak match_results, match_stats en team_match_stats voor eindstand, ruststand, xG, shots, cards, corners en possession.
- Bewaar RESULT_PENDING, CANCELLED en POSTPONED als statussen, niet als ontbrekende scores.

## Fase 3 - Seizoenbeheer
- Maak standings_snapshots, team_season_stats en season_archives.
- Archiveer bij seizoenafsluiting standings, fixtures, resultaten, predictions en modelevaluaties immutable.
- Open automatisch het volgende seizoen op basis van competition calendar en status.

## Fase 4 - Prediction Ledger
- Behoud prediction_snapshots, odds_snapshots, match_results en prediction_evaluations.
- Voeg model_versions, calibration_profiles en feature_vectors toe voor reproduceerbare modelruns.
- ROI/CLV pas activeren bij echte odds_at_prediction plus closing odds.

## Migratieregels
- Geen historische JSON-data verwijderen voordat database-import is gevalideerd.
- Iedere import moet idempotent zijn op provider_id of canonical_match_key.
- Iedere wijziging moet readiness, regression en datakwaliteitchecks doorstaan.
