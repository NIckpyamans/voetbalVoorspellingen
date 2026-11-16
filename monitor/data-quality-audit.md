# Data Quality Audit

Laatst bijgewerkt: 2026-11-16T10:14:34.631Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 468
- Oude wedstrijden: 163
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 37%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 468/457
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 83%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 95%
- Verse getimestampte prematch-odds: 4%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 79%
- Kaarten met tijdlijn: 81%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 53 duels, vorm 100%, H2H 6%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 36 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 42%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 78%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- England - Premier League: 51 duels, vorm 100%, H2H 63%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 72 duels, vorm 100%, H2H 51%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 37 duels, vorm 100%, H2H 78%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 90%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 28 duels, vorm 100%, H2H 46%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 36%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
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
- H2H mist: 2026-11-02: Heracles Almelo - TOP Oss
- H2H mist: 2026-11-02: Jong Ajax - Vitesse
- H2H mist: 2026-11-02: Jong FC Utrecht - FC Dordrecht
- H2H mist: 2026-11-02: Jong PSV - NAC Breda
- H2H mist: 2026-11-02: Stade de Reims - Sochaux
- H2H mist: 2026-11-03: Charlton Athletic - Bolton Wanderers
- H2H mist: 2026-11-03: Preston North End - Sheffield United
- H2H mist: 2026-11-03: Queens Park Rangers - Burnley
- H2H mist: 2026-11-03: Watford - Lincoln City
- H2H mist: 2026-11-03: West Bromwich Albion - Southampton
