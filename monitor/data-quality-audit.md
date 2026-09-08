# Data Quality Audit

Laatst bijgewerkt: 2026-09-08T07:32:35.962Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 703
- Oude wedstrijden: 340
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 42%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 100% (15/15)
- Bruikbare wedstrijdstatistieken: 88%
- Bevestigde opstellingen: 13%
- Historisch teruggevonden basiselftallen: 73%
- Verse getimestampte prematch-odds: 11%
- Volledige pre-match bewijsset: 3%
- Doelpunten met tijdlijn: 82%
- Kaarten met tijdlijn: 85%

## Per competitie
- Netherlands - Eredivisie: 30 duels, vorm 67%, H2H 30%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 113 duels, vorm 32%, H2H 9%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 80 duels, vorm 80%, H2H 49%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 81%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Germany - 2. Bundesliga: 30 duels, vorm 53%, H2H 30%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Premier League: 90 duels, vorm 86%, H2H 54%, inzetbewijs 2%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 59 duels, vorm 37%, H2H 34%, inzetbewijs 14%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 81 duels, vorm 80%, H2H 70%, inzetbewijs 1%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 81 duels, vorm 57%, H2H 49%, inzetbewijs 9%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Champions League: 32 duels, vorm 69%, H2H 22%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 38 duels, vorm 16%, H2H 50%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 63%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
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
