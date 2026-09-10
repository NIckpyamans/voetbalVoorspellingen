# Data Quality Audit

Laatst bijgewerkt: 2026-09-10T18:06:32.158Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 725
- Oude wedstrijden: 363
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 49%
- Reviews na afloop: 96%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 100% (15/15)
- Bruikbare wedstrijdstatistieken: 89%
- Bevestigde opstellingen: 12%
- Historisch teruggevonden basiselftallen: 68%
- Verse getimestampte prematch-odds: 11%
- Volledige pre-match bewijsset: 3%
- Doelpunten met tijdlijn: 83%
- Kaarten met tijdlijn: 86%

## Per competitie
- Netherlands - Eredivisie: 30 duels, vorm 90%, H2H 57%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 113 duels, vorm 35%, H2H 12%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 83 duels, vorm 92%, H2H 60%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 80%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Germany - 2. Bundesliga: 30 duels, vorm 73%, H2H 47%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Premier League: 90 duels, vorm 96%, H2H 61%, inzetbewijs 2%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 59 duels, vorm 59%, H2H 56%, inzetbewijs 14%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 81 duels, vorm 86%, H2H 72%, inzetbewijs 1%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 81 duels, vorm 62%, H2H 52%, inzetbewijs 9%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Champions League: 32 duels, vorm 75%, H2H 56%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 57 duels, vorm 26%, H2H 33%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 63%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Conference League: 69 duels, vorm 32%, H2H 49%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 70%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline

## Aanbevelingen
- Resultaatbackfill is schoon binnen de auditperiode.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Afgeronde wedstrijden zijn aan post-matchreviews gekoppeld.
- Post-match statistiekdekking is voldoende.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- H2H mist: 2026-08-16: Arminia Bielefeld - Energie Cottbus
- H2H mist: 2026-08-16: Dynamo Dresden - Darmstadt
- H2H mist: 2026-08-16: Hannover 96 - Wolfsburg
- H2H mist: 2026-08-17: De Graafschap - Jong AZ Alkmaar
- H2H mist: 2026-08-17: Jong Ajax - FC Emmen
- H2H mist: 2026-08-17: Jong FC Utrecht - Vitesse
- H2H mist: 2026-08-18: Dinamo Zagreb - Viking
- H2H mist: 2026-08-18: Fenerbahçe - Lyon
- H2H mist: 2026-08-18: Levski Sofia - AEK Athens
- H2H mist: 2026-08-19: Celtic - LASK
