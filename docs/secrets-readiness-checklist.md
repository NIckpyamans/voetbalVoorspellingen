# Secrets Readiness Checklist

Laatst bijgewerkt: 2026-06-03

## Huidige status
- Vercel bevat ODDS_API_URL_TEMPLATE en ODDS_PROVIDER_NAME.
- GitHub Actions bevat ODDS_API_URL_TEMPLATE en ODDS_PROVIDER_NAME.
- DATABASE_URL, POSTGRES_URL of SUPABASE_DB_URL ontbreekt nog.
- ODDS_API_KEY of THE_ODDS_API_KEY ontbreekt nog.

## Database activeren
1. Voeg een echte Postgres connection string toe als DATABASE_URL of POSTGRES_URL in Vercel en GitHub Actions.
2. Draai daarna `npm run readiness`.
3. Draai daarna `npm run db:schema:apply`.
4. Controleer of matches, prediction_snapshots, odds_snapshots, match_results en prediction_evaluations gevuld kunnen worden.

## Odds activeren
1. Voeg ODDS_API_KEY of THE_ODDS_API_KEY toe in Vercel en GitHub Actions.
2. Houd ODDS_API_URL_TEMPLATE en ODDS_PROVIDER_NAME gevuld.
3. Draai daarna worker/learn opnieuw.
4. Beoordeel ROI/CLV pas als odds_at_prediction en closing odds werkelijk in opslag staan.

## Veiligheidsregels
- Log nooit secretwaarden.
- Gebruik readiness alleen voor ja/nee-controle.
- Geen ROI/CLV-beslissingen op historische market proxies.
- Geen database migratie uitvoeren op productie zonder schema.sql review.
