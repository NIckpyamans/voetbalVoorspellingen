# Data Quality Audit

Laatst bijgewerkt: 2026-08-29T15:50:42.839Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 674
- Oude wedstrijden: 259
- Pending result backfills: 2
- Ontbrekende oude scores: 0
- H2H-dekking: 38%
- Reviews na afloop: 90%
- Lekvrije post-matchreviews: 100% (113/113)
- Bruikbare wedstrijdstatistieken: 77%
- Bevestigde opstellingen: 10%
- Historisch teruggevonden basiselftallen: 30%
- Verse getimestampte prematch-odds: 3%
- Volledige pre-match bewijsset: 2%
- Doelpunten met tijdlijn: 54%
- Kaarten met tijdlijn: 57%

## Per competitie
- Netherlands - Eredivisie: 6 duels, vorm 100%, H2H 33%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, leak_free_reviews
- Netherlands - Eerste Divisie: 113 duels, vorm 28%, H2H 9%, inzetbewijs 0%, lekvrije reviews 100% (17/17), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds
- Germany - Bundesliga: 79 duels, vorm 91%, H2H 52%, inzetbewijs 0%, lekvrije reviews 100% (6/6), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds
- Germany - 2. Bundesliga: 18 duels, vorm 72%, H2H 11%, inzetbewijs 0%, lekvrije reviews 100% (5/5), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds
- England - Premier League: 90 duels, vorm 98%, H2H 53%, inzetbewijs 2%, lekvrije reviews 100% (12/12), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds
- England - Championship: 7 duels, vorm 14%, H2H 43%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, leak_free_reviews
- France - Ligue 1: 82 duels, vorm 89%, H2H 66%, inzetbewijs 1%, lekvrije reviews 100% (10/10), stats 100%; gaten: confirmed_lineups, timestamped_odds
- France - Ligue 2: 81 duels, vorm 59%, H2H 41%, inzetbewijs 9%, lekvrije reviews 100% (16/16), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds
- Europe - Champions League: 14 duels, vorm 43%, H2H 50%, inzetbewijs 0%, lekvrije reviews 100% (3/3), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds
- Europe - Europa League: 51 duels, vorm 18%, H2H 37%, inzetbewijs 0%, lekvrije reviews 100% (10/10), stats 66%; gaten: form, h2h, confirmed_lineups, timestamped_odds, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Conference League: 133 duels, vorm 17%, H2H 26%, inzetbewijs 0%, lekvrije reviews 100% (34/34), stats 66%; gaten: form, h2h, confirmed_lineups, timestamped_odds, post_match_statistics, referee, goal_timeline, card_timeline

## Aanbevelingen
- Vul eerst betrouwbare eindstanden aan voordat learning en ROI/CLV zwaarder worden gewogen.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Afgeronde wedstrijden zijn aan post-matchreviews gekoppeld.
- Vul post-match statistieken en doelminuten via FotMob, APIfootball.com of GOAL shadow aan; nulvelden tellen niet als echte statistiek.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- Pending: 2026-07-23: NK Varazdin - Hradec Kralove
- Pending: 2026-07-23: Tromsø - Viktoria Plzen
- H2H mist: 2026-07-23: Qarabag FK - CSKA Sofia
- H2H mist: 2026-07-23: Dynamo Kyiv - PAOK Salonika
- H2H mist: 2026-07-23: Hammarby - Anderlecht
- H2H mist: 2026-07-23: Sheriff Tiraspol (Mol) - Maccabi Tel Aviv
- H2H mist: 2026-07-23: Tromso - Hradec Králové
- H2H mist: 2026-07-23: Beşiktaş - FC Midtjylland
- H2H mist: 2026-07-23: FC Twente - Ferencvaros
- H2H mist: 2026-07-23: St. Gallen - Benfica
- H2H mist: 2026-07-23: Hajduk Split - Pafos FC
- H2H mist: 2026-07-23: Malisheva - Hibernian
