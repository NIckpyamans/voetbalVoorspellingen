# Data Quality Audit

Laatst bijgewerkt: 2026-11-26T11:40:58.325Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 464
- Oude wedstrijden: 120
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 46%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 464/452
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 90%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 83%
- Verse getimestampte prematch-odds: 2%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 88%
- Kaarten met tijdlijn: 88%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 67%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 51 duels, vorm 100%, H2H 88%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 37 duels, vorm 100%, H2H 57%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 80%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 39%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 78%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- England - Premier League: 50 duels, vorm 100%, H2H 66%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 72 duels, vorm 100%, H2H 49%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 78%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 27 duels, vorm 100%, H2H 52%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 44%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Champions League: 38 duels, vorm 100%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 90%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 43 duels, vorm 93%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Conference League: 38 duels, vorm 74%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews

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
