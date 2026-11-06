# Data Quality Audit

Laatst bijgewerkt: 2026-11-06T15:26:58.931Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 456
- Oude wedstrijden: 205
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 35%
- Reviews na afloop: 84%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 456/443
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 84%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 82%
- Verse getimestampte prematch-odds: 11%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 80%
- Kaarten met tijdlijn: 83%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 50%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 48 duels, vorm 100%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 38 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 83%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 50%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 88%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Premier League: 40 duels, vorm 100%, H2H 55%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 72 duels, vorm 100%, H2H 50%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 75%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 88%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- France - Ligue 2: 31 duels, vorm 100%, H2H 42%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 39%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
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
- H2H mist: 2026-10-24: Charlton Athletic - Norwich City
- H2H mist: 2026-10-24: Sheffield United - Derby County
- H2H mist: 2026-10-24: Blackburn Rovers - Wrexham
- H2H mist: 2026-10-24: Cardiff City - Birmingham City
- H2H mist: 2026-10-24: Lincoln City - Burnley
- H2H mist: 2026-10-24: Preston North End - West Bromwich Albion
- H2H mist: 2026-10-24: Queens Park Rangers - Swansea City
- H2H mist: 2026-10-24: Stoke City - Bristol City
- H2H mist: 2026-10-24: Wolverhampton Wanderers - Watford
- H2H mist: 2026-10-24: Aston Villa - Manchester City
