# Data Quality Audit

Laatst bijgewerkt: 2026-11-11T09:59:31.450Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 454
- Oude wedstrijden: 225
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 37%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 454/443
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 84%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 87%
- Verse getimestampte prematch-odds: 8%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 80%
- Kaarten met tijdlijn: 82%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 56%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 51 duels, vorm 100%, H2H 4%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 95%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 36 duels, vorm 100%, H2H 67%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 44%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 78%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- England - Premier League: 41 duels, vorm 100%, H2H 61%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 72 duels, vorm 100%, H2H 53%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 75%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 27 duels, vorm 100%, H2H 48%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 44%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Champions League: 38 duels, vorm 100%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 84%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Europe - Europa League: 43 duels, vorm 88%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 71%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Europe - Conference League: 38 duels, vorm 71%, H2H 3%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 58%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline

## Aanbevelingen
- Resultaatbackfill is schoon binnen de auditperiode.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Evalueer minimaal 95% van de 0 geldige immutable snapshots voordat opnieuw wordt gekalibreerd.
- Post-match statistiekdekking is voldoende.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- H2H mist: 2026-10-30: Nantes - Clermont Foot
- H2H mist: 2026-10-30: Arminia Bielefeld - TSV Eintracht Braunschweig
- H2H mist: 2026-10-30: Energie Cottbus - VfL Bochum
- H2H mist: 2026-10-30: SV Elversberg - Mainz
- H2H mist: 2026-10-30: FC Volendam - De Graafschap
- H2H mist: 2026-10-30: Helmond Sport - FC Eindhoven
- H2H mist: 2026-10-30: RKC Waalwijk - Almere City
- H2H mist: 2026-10-30: Roda JC Kerkrade - Jong AZ
- H2H mist: 2026-10-31: Lincoln City - Birmingham City
- H2H mist: 2026-10-31: Stoke City - Preston North End
