# Data Quality Audit

Laatst bijgewerkt: 2026-08-28T07:08:54.499Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 669
- Oude wedstrijden: 242
- Pending result backfills: 2
- Ontbrekende oude scores: 0
- H2H-dekking: 40%
- Reviews na afloop: 89%
- Lekvrije post-matchreviews: 100% (130/130)
- Bruikbare wedstrijdstatistieken: 74%
- Bevestigde opstellingen: 10%
- Historisch teruggevonden basiselftallen: 38%
- Verse getimestampte prematch-odds: 3%
- Volledige pre-match bewijsset: 2%
- Doelpunten met tijdlijn: 50%
- Kaarten met tijdlijn: 53%

## Per competitie
- Netherlands - Eredivisie: 6 duels, vorm 100%, H2H 33%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, leak_free_reviews
- Netherlands - Eerste Divisie: 113 duels, vorm 25%, H2H 11%, inzetbewijs 0%, lekvrije reviews 100% (8/8), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds
- Germany - Bundesliga: 78 duels, vorm 95%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, leak_free_reviews
- Germany - 2. Bundesliga: 14 duels, vorm 71%, H2H 14%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, leak_free_reviews
- England - Premier League: 90 duels, vorm 98%, H2H 59%, inzetbewijs 2%, lekvrije reviews 100% (9/9), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds
- England - Championship: 7 duels, vorm 14%, H2H 43%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, leak_free_reviews
- France - Ligue 1: 82 duels, vorm 90%, H2H 68%, inzetbewijs 1%, lekvrije reviews 100% (9/9), stats 100%; gaten: confirmed_lineups, timestamped_odds, goal_timeline
- France - Ligue 2: 81 duels, vorm 58%, H2H 44%, inzetbewijs 9%, lekvrije reviews 100% (8/8), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds
- Europe - Champions League: 14 duels, vorm 43%, H2H 50%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, leak_free_reviews
- Europe - Europa League: 51 duels, vorm 18%, H2H 37%, inzetbewijs 0%, lekvrije reviews 100% (29/29), stats 66%; gaten: form, h2h, confirmed_lineups, timestamped_odds, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Conference League: 133 duels, vorm 17%, H2H 26%, inzetbewijs 0%, lekvrije reviews 100% (67/67), stats 66%; gaten: form, h2h, confirmed_lineups, timestamped_odds, post_match_statistics, referee, goal_timeline, card_timeline

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
