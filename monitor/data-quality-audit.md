# Data Quality Audit

Laatst bijgewerkt: 2026-10-15T11:35:42.995Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 519
- Oude wedstrijden: 116
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 34%
- Reviews na afloop: 93%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 519/503
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 89%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 93%
- Verse getimestampte prematch-odds: 6%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 88%
- Kaarten met tijdlijn: 85%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 53%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 48 duels, vorm 100%, H2H 13%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 36 duels, vorm 100%, H2H 56%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 47%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 78%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- England - Premier League: 40 duels, vorm 100%, H2H 57%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 73 duels, vorm 100%, H2H 32%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 81%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 36 duels, vorm 100%, H2H 56%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 33%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Champions League: 57 duels, vorm 93%, H2H 33%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 84%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 64 duels, vorm 86%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Conference League: 57 duels, vorm 60%, H2H 2%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews

## Aanbevelingen
- Resultaatbackfill is schoon binnen de auditperiode.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Evalueer minimaal 95% van de 0 geldige immutable snapshots voordat opnieuw wordt gekalibreerd.
- Post-match statistiekdekking is voldoende.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- H2H mist: 2026-10-02: Helmond Sport - Heracles Almelo
- H2H mist: 2026-10-03: TOP Oss - MVV Maastricht
- H2H mist: 2026-10-03: Vitesse - NAC Breda
- H2H mist: 2026-10-03: FC Den Bosch - FC Dordrecht
- H2H mist: 2026-10-03: FC Eindhoven - De Graafschap
- H2H mist: 2026-10-04: VVV-Venlo - Roda JC Kerkrade
- H2H mist: 2026-10-09: Almere City - FC Eindhoven
- H2H mist: 2026-10-09: De Graafschap - Jong FC Utrecht
- H2H mist: 2026-10-09: FC Dordrecht - FC Emmen
- H2H mist: 2026-10-09: Heracles Almelo - RKC Waalwijk
