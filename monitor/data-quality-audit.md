# Data Quality Audit

Laatst bijgewerkt: 2026-11-21T10:18:32.540Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 462
- Oude wedstrijden: 82
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 41%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 462/451
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 89%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 92%
- Verse getimestampte prematch-odds: 4%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 88%
- Kaarten met tijdlijn: 85%

## Per competitie
- Netherlands - Eredivisie: 35 duels, vorm 100%, H2H 60%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 53 duels, vorm 100%, H2H 36%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 36 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 47%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 78%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- England - Premier League: 49 duels, vorm 100%, H2H 63%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 72 duels, vorm 100%, H2H 51%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 75%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 26 duels, vorm 100%, H2H 54%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 38%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Champions League: 38 duels, vorm 100%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 43 duels, vorm 93%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Conference League: 38 duels, vorm 74%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews

## Aanbevelingen
- Resultaatbackfill is schoon binnen de auditperiode.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Evalueer minimaal 95% van de 0 geldige immutable snapshots voordat opnieuw wordt gekalibreerd.
- Post-match statistiekdekking is voldoende.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- H2H mist: 2026-11-07: Wrexham - Wolverhampton Wanderers
- H2H mist: 2026-11-07: Blackburn Rovers - West Ham United
- H2H mist: 2026-11-07: Preston North End - Southampton
- H2H mist: 2026-11-07: Queens Park Rangers - Lincoln City
- H2H mist: 2026-11-07: West Bromwich Albion - Millwall
- H2H mist: 2026-11-07: Arsenal - Hull City
- H2H mist: 2026-11-07: Nottingham Forest - Manchester City
- H2H mist: 2026-11-07: AJ Auxerre - Paris FC
- H2H mist: 2026-11-07: Clermont Foot - Rodez Aveyron
- H2H mist: 2026-11-07: Pau - Nantes
