# Data Quality Audit

Laatst bijgewerkt: 2026-11-28T11:04:10.339Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 494
- Oude wedstrijden: 173
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 45%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 494/483
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 83%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 86%
- Verse getimestampte prematch-odds: 1%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 80%
- Kaarten met tijdlijn: 81%

## Per competitie
- Netherlands - Eredivisie: 37 duels, vorm 100%, H2H 65%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 59 duels, vorm 100%, H2H 90%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 83%; gaten: confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, card_timeline
- Germany - Bundesliga: 37 duels, vorm 100%, H2H 57%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 90%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 38 duels, vorm 100%, H2H 40%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 73%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- England - Premier League: 50 duels, vorm 100%, H2H 64%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 73 duels, vorm 100%, H2H 48%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 78%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 90%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 27 duels, vorm 100%, H2H 52%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 44%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Champions League: 38 duels, vorm 100%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 90%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 42 duels, vorm 95%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 76%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Europe - Conference League: 57 duels, vorm 93%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 58%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline

## Aanbevelingen
- Resultaatbackfill is schoon binnen de auditperiode.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Evalueer minimaal 95% van de 0 geldige immutable snapshots voordat opnieuw wordt gekalibreerd.
- Post-match statistiekdekking is voldoende.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- H2H mist: 2026-11-14: FC Dordrecht - Heracles Almelo
- H2H mist: 2026-11-20: Troyes - Le Havre AC
- H2H mist: 2026-11-20: Annecy - Clermont Foot
- H2H mist: 2026-11-20: AS Nancy Lorraine - Dijon FCO
- H2H mist: 2026-11-20: Metz - Boulogne
- H2H mist: 2026-11-20: Arminia Bielefeld - 1. FC Magdeburg
- H2H mist: 2026-11-20: Almere City - NAC Breda
- H2H mist: 2026-11-20: Heracles Almelo - Jong PSV
- H2H mist: 2026-11-21: Millwall - Queens Park Rangers
- H2H mist: 2026-11-21: Bolton Wanderers - Portsmouth
