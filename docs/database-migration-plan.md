# Database Migratieplan

Laatst bijgewerkt: 2026-06-03T09:54:08.739Z

## Doel
Maak Postgres/Supabase de bron van waarheid voor een schaalbaar voetbal intelligence platform. JSON blijft alleen cache, export of fallback.

## Fase 1 - Fundament
- Maak tabellen voor countries, competitions, competition_seasons, clubs, club_aliases, venues en matches.
- Voeg source_records toe voor ruwe bronpayloads met provider, fetched_at, source_url, content_hash en trust_score.
- Voeg source_audit toe per genormaliseerd veld zodat iedere voorspelling herleidbaar blijft.
- Voeg model_versions en calibration_profiles toe om modelruns reproduceerbaar te maken.

## Fase 2 - Wedstrijddata
- Breid matches uit met season_id, competition_id, home_club_id, away_club_id en status_normalized.
- Maak match_results, match_stats en team_match_stats voor eindstand, ruststand, xG, shots, cards, corners en possession.
- Maak h2h_edges voor onderlinge historie per clubpaar en competitiecontext.
- Bewaar RESULT_PENDING, CANCELLED en POSTPONED als statussen, niet als ontbrekende scores.

## Fase 3 - Seizoenbeheer
- Maak standings_snapshots, team_season_stats en season_archives.
- Maak players, squads, injuries en suspensions voor selectiecontext per seizoen en wedstrijd.
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

## Secrets-gate
- DATABASE_URL, POSTGRES_URL of SUPABASE_DB_URL moet gevuld zijn voordat `npm run db:schema:apply` wordt uitgevoerd.
- ODDS_API_KEY of THE_ODDS_API_KEY moet gevuld zijn voordat ROI/CLV live wordt beoordeeld.
- Zie docs/secrets-readiness-checklist.md voor de actuele checklist.
