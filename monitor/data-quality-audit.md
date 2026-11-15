# Data Quality Audit

Laatst bijgewerkt: 2026-11-15T09:59:28.599Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 463
- Oude wedstrijden: 177
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 37%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 463/452
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 84%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 94%
- Verse getimestampte prematch-odds: 5%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 80%
- Kaarten met tijdlijn: 81%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 50 duels, vorm 100%, H2H 4%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 36 duels, vorm 100%, H2H 64%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 91%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 44%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 83%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- England - Premier League: 49 duels, vorm 100%, H2H 61%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 71 duels, vorm 100%, H2H 52%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 38 duels, vorm 100%, H2H 76%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 86%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
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
- H2H mist: 2026-11-01: Strasbourg - AJ Auxerre
- H2H mist: 2026-11-01: Hannover 96 - Dynamo Dresden
- H2H mist: 2026-11-01: FC Emmen - FC Den Bosch
- H2H mist: 2026-11-01: PEC Zwolle - ADO Den Haag
- H2H mist: 2026-11-02: Heracles Almelo - TOP Oss
- H2H mist: 2026-11-02: Jong Ajax - Vitesse
- H2H mist: 2026-11-02: Jong FC Utrecht - FC Dordrecht
- H2H mist: 2026-11-02: Jong PSV - NAC Breda
- H2H mist: 2026-11-02: Stade de Reims - Sochaux
- H2H mist: 2026-11-03: Charlton Athletic - Bolton Wanderers
