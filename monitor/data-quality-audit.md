# Data Quality Audit

Laatst bijgewerkt: 2026-11-17T11:11:31.139Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 462
- Oude wedstrijden: 155
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 37%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 462/451
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 83%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 94%
- Verse getimestampte prematch-odds: 4%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 79%
- Kaarten met tijdlijn: 81%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 50 duels, vorm 100%, H2H 6%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 36 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 42%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 78%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- England - Premier League: 50 duels, vorm 100%, H2H 62%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 72 duels, vorm 100%, H2H 51%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 78%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 27 duels, vorm 100%, H2H 48%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 44%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Champions League: 38 duels, vorm 100%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 84%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Europe - Europa League: 43 duels, vorm 88%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 71%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Europe - Conference League: 38 duels, vorm 71%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 58%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline

## Aanbevelingen
- Resultaatbackfill is schoon binnen de auditperiode.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Evalueer minimaal 95% van de 0 geldige immutable snapshots voordat opnieuw wordt gekalibreerd.
- Post-match statistiekdekking is voldoende.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- H2H mist: 2026-11-03: Charlton Athletic - Bolton Wanderers
- H2H mist: 2026-11-03: Preston North End - Sheffield United
- H2H mist: 2026-11-03: Queens Park Rangers - Burnley
- H2H mist: 2026-11-03: Watford - Lincoln City
- H2H mist: 2026-11-03: West Bromwich Albion - Southampton
- H2H mist: 2026-11-03: Galatasaray - VfB Stuttgart
- H2H mist: 2026-11-03: Shakhtar Donetsk - Sporting CP
- H2H mist: 2026-11-03: Atlético Madrid - Bayern Munich
- H2H mist: 2026-11-03: Barcelona - Aston Villa
- H2H mist: 2026-11-03: Bodo/Glimt - Lille
