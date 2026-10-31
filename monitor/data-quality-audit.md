# Data Quality Audit

Laatst bijgewerkt: 2026-10-31T08:54:45.848Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 451
- Oude wedstrijden: 215
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 29%
- Reviews na afloop: 34%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 451/441
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 85%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 73%
- Verse getimestampte prematch-odds: 14%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 81%
- Kaarten met tijdlijn: 83%

## Per competitie
- Netherlands - Eredivisie: 35 duels, vorm 100%, H2H 49%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 53 duels, vorm 100%, H2H 6%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 36 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 47%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 78%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- England - Premier League: 40 duels, vorm 100%, H2H 45%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 60 duels, vorm 100%, H2H 18%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 78%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 90%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 36 duels, vorm 100%, H2H 39%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 50%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
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
- H2H mist: 2026-10-17: SV Elversberg - FC Augsburg
- H2H mist: 2026-10-17: Werder Bremen - SC Paderborn 07
- H2H mist: 2026-10-17: FC Emmen - Almere City
- H2H mist: 2026-10-17: Fulham - Hull City
- H2H mist: 2026-10-17: Manchester City - Ipswich Town
- H2H mist: 2026-10-17: Middlesbrough - Cardiff City
- H2H mist: 2026-10-17: Millwall - Lincoln City
- H2H mist: 2026-10-17: Watford - Charlton Athletic
- H2H mist: 2026-10-17: Birmingham City - Queens Park Rangers
- H2H mist: 2026-10-17: Derby County - Stoke City
