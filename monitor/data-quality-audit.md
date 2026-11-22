# Data Quality Audit

Laatst bijgewerkt: 2026-11-22T10:24:16.020Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 464
- Oude wedstrijden: 90
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 47%
- Reviews na afloop: 100%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 464/453
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 87%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 91%
- Verse getimestampte prematch-odds: 3%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 84%
- Kaarten met tijdlijn: 84%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 67%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 52 duels, vorm 100%, H2H 87%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 36 duels, vorm 100%, H2H 56%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 80%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 44%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 67%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- England - Premier League: 49 duels, vorm 100%, H2H 67%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 71 duels, vorm 100%, H2H 49%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 39 duels, vorm 100%, H2H 77%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 83%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 26 duels, vorm 100%, H2H 54%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 29%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
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
- H2H mist: 2026-11-08: Brighton & Hove Albion - Brentford
- H2H mist: 2026-11-08: Manchester United - Aston Villa
- H2H mist: 2026-11-08: Le Mans - AS Monaco
- H2H mist: 2026-11-08: FC Cologne - Bayer Leverkusen
- H2H mist: 2026-11-08: FC Emmen - MVV Maastricht
- H2H mist: 2026-11-08: Heerenveen - Feyenoord Rotterdam
- H2H mist: 2026-11-08: FC Twente - Ajax Amsterdam
- H2H mist: 2026-11-14: FC Dordrecht - Heracles Almelo
- H2H mist: 2026-11-20: Troyes - Le Havre AC
- H2H mist: 2026-11-20: Annecy - Clermont Foot
