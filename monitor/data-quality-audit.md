# Data Quality Audit

Laatst bijgewerkt: 2026-10-07T09:16:54.275Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 431
- Oude wedstrijden: 16
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 22%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0)
- Bruikbare wedstrijdstatistieken: 100%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 100%
- Verse getimestampte prematch-odds: 0%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 100%
- Kaarten met tijdlijn: 94%

## Per competitie
- Netherlands - Eredivisie: 27 duels, vorm 100%, H2H 44%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 46 duels, vorm 100%, H2H 17%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 38 duels, vorm 100%, H2H 34%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 30 duels, vorm 100%, H2H 27%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Premier League: 30 duels, vorm 100%, H2H 60%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 49 duels, vorm 100%, H2H 12%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 28 duels, vorm 96%, H2H 57%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 42 duels, vorm 64%, H2H 33%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Champions League: 40 duels, vorm 85%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 50 duels, vorm 76%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Conference League: 51 duels, vorm 41%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews

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
