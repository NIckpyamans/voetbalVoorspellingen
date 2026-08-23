# Data Quality Audit

Laatst bijgewerkt: 2026-08-23T18:12:32.265Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 687
- Oude wedstrijden: 163
- Pending result backfills: 2
- Ontbrekende oude scores: 0
- H2H-dekking: 59%
- Reviews na afloop: 33%
- Bruikbare wedstrijdstatistieken: 32%
- Bevestigde opstellingen: 0%
- Verse getimestampte prematch-odds: 0%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 0%

## Per competitie
- Netherlands - Eredivisie: 10 duels, vorm 70%, H2H 20%, inzetbewijs 0%, reviews 100%, stats 0%; gaten: form, h2h, confirmed_lineups, timestamped_odds, post_match_statistics, referee, goal_timeline
- Netherlands - Eerste Divisie: 111 duels, vorm 26%, H2H 17%, inzetbewijs 0%, reviews 13%, stats 13%; gaten: form, h2h, confirmed_lineups, timestamped_odds, reviews, post_match_statistics, referee, goal_timeline
- Germany - Bundesliga: 86 duels, vorm 93%, H2H 54%, inzetbewijs 0%, reviews 100%, stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds
- Germany - 2. Bundesliga: 12 duels, vorm 83%, H2H 33%, inzetbewijs 0%, reviews 100%, stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds
- England - Premier League: 90 duels, vorm 100%, H2H 67%, inzetbewijs 0%, reviews 33%, stats 33%; gaten: confirmed_lineups, timestamped_odds, reviews, post_match_statistics, referee, goal_timeline
- England - Championship: 13 duels, vorm 8%, H2H 15%, inzetbewijs 0%, reviews 100%, stats 0%; gaten: form, h2h, confirmed_lineups, timestamped_odds, post_match_statistics, referee, goal_timeline
- France - Ligue 1: 81 duels, vorm 94%, H2H 79%, inzetbewijs 0%, reviews 25%, stats 25%; gaten: confirmed_lineups, timestamped_odds, reviews, post_match_statistics, referee, goal_timeline
- France - Ligue 2: 85 duels, vorm 60%, H2H 51%, inzetbewijs 0%, reviews 0%, stats 0%; gaten: form, h2h, confirmed_lineups, timestamped_odds, reviews, post_match_statistics, referee, goal_timeline
- Europe - Champions League: 12 duels, vorm 0%, H2H 100%, inzetbewijs 0%, reviews 0%, stats 0%; gaten: form, confirmed_lineups, timestamped_odds, reviews, post_match_statistics, referee, goal_timeline
- Europe - Europa League: 51 duels, vorm 16%, H2H 90%, inzetbewijs 0%, reviews 26%, stats 29%; gaten: form, confirmed_lineups, timestamped_odds, reviews, post_match_statistics, referee, goal_timeline
- Europe - Conference League: 136 duels, vorm 25%, H2H 79%, inzetbewijs 0%, reviews 40%, stats 39%; gaten: form, confirmed_lineups, timestamped_odds, reviews, post_match_statistics, referee, goal_timeline

## Aanbevelingen
- Vul eerst betrouwbare eindstanden aan voordat learning en ROI/CLV zwaarder worden gewogen.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Koppel de ontbrekende reviews aan de 169 afgeronde wedstrijden voordat opnieuw wordt gekalibreerd.
- Vul post-match statistieken en doelminuten via FotMob, APIfootball.com of GOAL shadow aan; nulvelden tellen niet als echte statistiek.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- Pending: 2026-07-23: NK Varazdin - Hradec Kralove
- Pending: 2026-07-23: Tromsø - Viktoria Plzen
- H2H mist: 2026-07-23: Hammarby - Anderlecht
- H2H mist: 2026-07-23: FK Panevezys - Tobol Kostanay
- H2H mist: 2026-07-23: Raków Częstochowa - Valletta
- H2H mist: 2026-07-23: FCSB - Auda
- H2H mist: 2026-07-23: Vojvodina - Ajax
- H2H mist: 2026-07-23: Alashkert FC - CFR Cluj
- H2H mist: 2026-07-23: Debrecen - Pyunik
- H2H mist: 2026-07-23: Flora Tallinn - TNS
- H2H mist: 2026-07-23: HJK - Coleraine
- H2H mist: 2026-07-23: NK Varazdin - Hradec Kralove
