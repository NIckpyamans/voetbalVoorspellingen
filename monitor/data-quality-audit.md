# Data Quality Audit

Laatst bijgewerkt: 2026-10-11T09:24:07.235Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 429
- Oude wedstrijden: 68
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 25%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 429/418
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 88%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 96%
- Verse getimestampte prematch-odds: 3%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 87%
- Kaarten met tijdlijn: 82%

## Per competitie
- Netherlands - Eredivisie: 32 duels, vorm 100%, H2H 41%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 44 duels, vorm 100%, H2H 14%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 34 duels, vorm 100%, H2H 44%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 86%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 33 duels, vorm 100%, H2H 33%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 83%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline, card_timeline
- England - Premier League: 38 duels, vorm 100%, H2H 53%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 61 duels, vorm 100%, H2H 12%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 33 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 83%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 35 duels, vorm 100%, H2H 43%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 38%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Champions League: 38 duels, vorm 90%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 43 duels, vorm 88%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Conference League: 38 duels, vorm 55%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews

## Aanbevelingen
- Resultaatbackfill is schoon binnen de auditperiode.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Evalueer minimaal 95% van de 0 geldige immutable snapshots voordat opnieuw wordt gekalibreerd.
- Post-match statistiekdekking is voldoende.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- H2H mist: 2026-09-27: De Graafschap - FC Den Bosch
- H2H mist: 2026-10-02: Helmond Sport - Heracles Almelo
- H2H mist: 2026-10-03: TOP Oss - MVV Maastricht
- H2H mist: 2026-10-03: Vitesse - NAC Breda
- H2H mist: 2026-10-03: FC Den Bosch - FC Dordrecht
- H2H mist: 2026-10-03: FC Eindhoven - De Graafschap
- H2H mist: 2026-10-04: VVV-Venlo - Roda JC Kerkrade
- H2H mist: 2026-10-09: Almere City - FC Eindhoven
- H2H mist: 2026-10-09: De Graafschap - Jong FC Utrecht
- H2H mist: 2026-10-09: FC Dordrecht - FC Emmen
