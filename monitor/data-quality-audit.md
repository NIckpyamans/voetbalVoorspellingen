# Data Quality Audit

Laatst bijgewerkt: 2026-11-20T10:33:12.902Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 462
- Oude wedstrijden: 84
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 37%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 462/451
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 89%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 95%
- Verse getimestampte prematch-odds: 4%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 86%
- Kaarten met tijdlijn: 86%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 50 duels, vorm 100%, H2H 6%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 36 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 42%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 78%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- England - Premier League: 50 duels, vorm 100%, H2H 62%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 72 duels, vorm 100%, H2H 51%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 78%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 27 duels, vorm 100%, H2H 48%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 44%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
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
- H2H mist: 2026-11-06: Derby County - Bolton Wanderers
- H2H mist: 2026-11-06: Everton - Coventry City
- H2H mist: 2026-11-06: AS Nancy Lorraine - Sochaux
- H2H mist: 2026-11-06: Dijon FCO - Red Star FC 93
- H2H mist: 2026-11-06: Dynamo Dresden - SpVgg Greuther Fürth
- H2H mist: 2026-11-06: TSV Eintracht Braunschweig - Energie Cottbus
- H2H mist: 2026-11-06: Hamburg SV - Borussia Mönchengladbach
- H2H mist: 2026-11-06: FC Dordrecht - NAC Breda
- H2H mist: 2026-11-06: FC Eindhoven - Jong Ajax
- H2H mist: 2026-11-06: Helmond Sport - FC Volendam
