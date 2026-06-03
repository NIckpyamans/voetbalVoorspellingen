# Kwaliteitsregels

## Ingestieregels
- Iedere bronpayload krijgt een `source_records` rij met provider, URL, fetch-tijd, hash en trust score.
- Iedere genormaliseerde waarde met beslisimpact krijgt een `source_audit` verwijzing.
- Provider IDs zijn nooit genoeg; bewaar ook genormaliseerde naamkeys als fallback.
- Nieuwe databronnen mogen bestaande scorevelden alleen overschrijven als de bronbetrouwbaarheid hoger is.

## Matchregels
- `matches.match_id` is stabiel en mag niet veranderen na publicatie.
- `match_results` mag alleen `FT`-achtige eindstanden bevatten, geen live tussenstanden.
- `RESULT_PENDING`, `POSTPONED`, `CANCELLED` en `ABANDONED` zijn statussen, geen ontbrekende data.
- Home/away mag nooit worden omgedraaid zonder expliciete bronvergelijking.

## Predictionregels
- `prediction_snapshots.generated_at <= matches.kickoff_at`.
- `prediction_snapshots.cutoff_at <= matches.kickoff_at`.
- Iedere prediction heeft probabilities die optellen tot 1.
- Hoge confidence wordt geblokkeerd als `data_completeness_score < 0.70`.
- Exact-score selectie moet passen bij 1X2-dominant outcome wanneer 1X2-edge sterk genoeg is.

## Oddsregels
- ROI en CLV blijven verborgen/onbetrouwbaar zolang echte odds credentials ontbreken.
- `odds_snapshots.captured_at <= prediction_snapshots.cutoff_at`.
- Closing odds worden apart gemarkeerd en mogen pre-match odds niet overschrijven.
- Bookmaker odds worden nooit in client-side secrets opgeslagen.

## Archiveringsregels
- Seizoenen worden immutable gearchiveerd na afsluiting.
- Standings, match results, predictions, evaluations en source lineage blijven bewaard.
- Een nieuw seizoen mag pas openen als het vorige seizoen `archived` of expliciet `closed` is.

## Regressietests
- BBC fallback-event contract blijft stabiel.
- ESPN fallback-event contract blijft stabiel.
- Poisson scorematrix probabilities blijven genormaliseerd.
- `npm run monitor:regressions` moet groen zijn voor iedere deploy.
