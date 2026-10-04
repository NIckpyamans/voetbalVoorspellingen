# Data Quality Audit

Laatst bijgewerkt: 2026-10-04T08:48:21.967Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 428
- Oude wedstrijden: 37
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 22%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0)
- Bruikbare wedstrijdstatistieken: 95%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 100%
- Verse getimestampte prematch-odds: 1%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 89%
- Kaarten met tijdlijn: 89%

## Per competitie
- Netherlands - Eredivisie: 26 duels, vorm 100%, H2H 39%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 47 duels, vorm 100%, H2H 17%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 40 duels, vorm 100%, H2H 38%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 60%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
- Germany - 2. Bundesliga: 29 duels, vorm 100%, H2H 24%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Premier League: 29 duels, vorm 100%, H2H 69%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- England - Championship: 51 duels, vorm 100%, H2H 8%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, card_timeline
- France - Ligue 1: 25 duels, vorm 96%, H2H 56%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 40 duels, vorm 65%, H2H 33%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
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
- H2H mist: 2026-09-20: Paderborn - Hoffenheim
- H2H mist: 2026-09-20: De Graafschap - NAC Breda
- H2H mist: 2026-09-20: Wolverhampton Wanderers - West Bromwich Albion
- H2H mist: 2026-09-20: SC Paderborn 07 - TSG Hoffenheim
- H2H mist: 2026-09-20: Arminia Bielefeld - FC Heidenheim
- H2H mist: 2026-09-20: Energie Cottbus - St. Pauli
- H2H mist: 2026-09-20: Norwich City - Bolton Wanderers
- H2H mist: 2026-09-25: FC Dordrecht - Almere City FC
- H2H mist: 2026-09-26: FC Emmen - TOP Oss
- H2H mist: 2026-09-26: FC Volendam - VVV-Venlo
