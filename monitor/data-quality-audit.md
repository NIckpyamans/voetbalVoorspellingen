# Data Quality Audit

Laatst bijgewerkt: 2026-10-03T08:35:12.210Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 427
- Oude wedstrijden: 68
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 23%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0)
- Bruikbare wedstrijdstatistieken: 97%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 100%
- Verse getimestampte prematch-odds: 2%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 94%
- Kaarten met tijdlijn: 94%

## Per competitie
- Netherlands - Eredivisie: 27 duels, vorm 100%, H2H 37%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 47 duels, vorm 100%, H2H 17%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 38 duels, vorm 100%, H2H 45%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 82%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Germany - 2. Bundesliga: 29 duels, vorm 100%, H2H 21%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Premier League: 30 duels, vorm 100%, H2H 67%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 49 duels, vorm 100%, H2H 6%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 28 duels, vorm 96%, H2H 64%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 38 duels, vorm 68%, H2H 37%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
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
- H2H mist: 2026-09-19: Borussia Mönchengladbach - Mainz 05
- H2H mist: 2026-09-19: Vitesse - Jong PSV
- H2H mist: 2026-09-19: Boulogne - Nantes
- H2H mist: 2026-09-19: Metz - Saint-Étienne
- H2H mist: 2026-09-19: Le Mans - Lorient
- H2H mist: 2026-09-19: Everton - Ipswich Town
- H2H mist: 2026-09-19: Newcastle United - Hull City
- H2H mist: 2026-09-19: Nottingham Forest - Coventry City
- H2H mist: 2026-09-19: Wrexham - Southampton
- H2H mist: 2026-09-19: Willem II - Fortuna Sittard
