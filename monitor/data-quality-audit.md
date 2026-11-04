# Data Quality Audit

Laatst bijgewerkt: 2026-11-04T09:58:50.488Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 459
- Oude wedstrijden: 223
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 29%
- Reviews na afloop: 54%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 459/447
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 85%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 76%
- Verse getimestampte prematch-odds: 12%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 80%
- Kaarten met tijdlijn: 83%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 50%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 50 duels, vorm 100%, H2H 6%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 38 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 84%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 47%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 83%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- England - Premier League: 40 duels, vorm 100%, H2H 38%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 68 duels, vorm 100%, H2H 21%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 75%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- France - Ligue 2: 36 duels, vorm 100%, H2H 42%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 50%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Champions League: 38 duels, vorm 100%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 79%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Europe - Europa League: 43 duels, vorm 86%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 71%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Europe - Conference League: 38 duels, vorm 68%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 63%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline

## Aanbevelingen
- Resultaatbackfill is schoon binnen de auditperiode.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Evalueer minimaal 95% van de 0 geldige immutable snapshots voordat opnieuw wordt gekalibreerd.
- Post-match statistiekdekking is voldoende.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- H2H mist: 2026-10-21: Como - Manchester United
- H2H mist: 2026-10-21: Lille - Galatasaray
- H2H mist: 2026-10-21: Aston Villa - Viking FK
- H2H mist: 2026-10-21: Bayern Munich - Arsenal
- H2H mist: 2026-10-21: Club Brugge - Lens
- H2H mist: 2026-10-21: Internazionale - Shakhtar Donetsk
- H2H mist: 2026-10-21: Real Betis - Feyenoord Rotterdam
- H2H mist: 2026-10-21: Real Madrid - RB Leipzig
- H2H mist: 2026-10-21: Sporting CP - LASK Linz
- H2H mist: 2026-10-22: Kairat Almaty - Panathinaikos
