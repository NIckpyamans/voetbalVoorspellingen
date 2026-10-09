# Data Quality Audit

Laatst bijgewerkt: 2026-10-09T09:40:26.928Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 379
- Oude wedstrijden: 16
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 27%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 379/368
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 100%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 100%
- Verse getimestampte prematch-odds: 0%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 100%
- Kaarten met tijdlijn: 94%

## Per competitie
- Netherlands - Eredivisie: 27 duels, vorm 100%, H2H 48%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 46 duels, vorm 100%, H2H 17%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 27 duels, vorm 100%, H2H 48%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 27 duels, vorm 100%, H2H 33%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Premier League: 30 duels, vorm 100%, H2H 63%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 49 duels, vorm 100%, H2H 14%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 27 duels, vorm 100%, H2H 70%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 27 duels, vorm 100%, H2H 52%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
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
- H2H mist: 2026-09-25: FC Dordrecht - Almere City FC
- H2H mist: 2026-09-26: FC Emmen - TOP Oss
- H2H mist: 2026-09-26: FC Volendam - VVV-Venlo
- H2H mist: 2026-09-26: NAC Breda - FC Eindhoven
- H2H mist: 2026-09-26: Roda JC Kerkrade - RKC Waalwijk
- H2H mist: 2026-09-27: De Graafschap - FC Den Bosch
- H2H mist: 2026-10-02: Helmond Sport - Heracles Almelo
- H2H mist: 2026-10-03: TOP Oss - MVV Maastricht
- H2H mist: 2026-10-03: Vitesse - NAC Breda
- H2H mist: 2026-10-03: FC Den Bosch - FC Dordrecht
