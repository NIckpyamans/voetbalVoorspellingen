# Data Quality Audit

Laatst bijgewerkt: 2026-10-30T09:02:36.589Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 449
- Oude wedstrijden: 214
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 29%
- Reviews na afloop: 36%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 449/439
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 85%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 77%
- Verse getimestampte prematch-odds: 13%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 80%
- Kaarten met tijdlijn: 84%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 50%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 48 duels, vorm 100%, H2H 6%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 36 duels, vorm 100%, H2H 56%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 47%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 83%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- England - Premier League: 40 duels, vorm 100%, H2H 45%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 61 duels, vorm 100%, H2H 18%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 78%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- France - Ligue 2: 37 duels, vorm 100%, H2H 43%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 50%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Europe - Champions League: 38 duels, vorm 97%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 84%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 43 duels, vorm 86%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 71%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Europe - Conference League: 38 duels, vorm 68%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 63%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline

## Aanbevelingen
- Resultaatbackfill is schoon binnen de auditperiode.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Evalueer minimaal 95% van de 0 geldige immutable snapshots voordat opnieuw wordt gekalibreerd.
- Post-match statistiekdekking is voldoende.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- H2H mist: 2026-10-16: FC Den Bosch - TOP Oss
- H2H mist: 2026-10-16: FC Eindhoven - Vitesse
- H2H mist: 2026-10-16: Helmond Sport - NAC Breda
- H2H mist: 2026-10-16: VVV-Venlo - Jong AZ
- H2H mist: 2026-10-16: Guingamp - Pau
- H2H mist: 2026-10-16: Stade Laval - Clermont Foot
- H2H mist: 2026-10-16: Stade de Reims - Dijon FCO
- H2H mist: 2026-10-16: Burnley - Wolverhampton Wanderers
- H2H mist: 2026-10-16: Le Mans - Toulouse
- H2H mist: 2026-10-16: Energie Cottbus - 1. FC Nürnberg
