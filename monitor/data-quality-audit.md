# Data Quality Audit

Laatst bijgewerkt: 2026-08-27T14:46:43.836Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 665
- Oude wedstrijden: 190
- Pending result backfills: 2
- Ontbrekende oude scores: 0
- H2H-dekking: 41%
- Reviews na afloop: 86%
- Lekvrije post-matchreviews: 100% (90/90)
- Bruikbare wedstrijdstatistieken: 76%
- Bevestigde opstellingen: 10%
- Historisch teruggevonden basiselftallen: 44%
- Verse getimestampte prematch-odds: 2%
- Volledige pre-match bewijsset: 2%
- Doelpunten met tijdlijn: 46%
- Kaarten met tijdlijn: 48%

## Per competitie
- Netherlands - Eredivisie: 5 duels, vorm 100%, H2H 40%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, leak_free_reviews
- Netherlands - Eerste Divisie: 113 duels, vorm 26%, H2H 10%, inzetbewijs 0%, lekvrije reviews 100% (10/10), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds
- Germany - Bundesliga: 78 duels, vorm 95%, H2H 59%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, leak_free_reviews
- Germany - 2. Bundesliga: 12 duels, vorm 67%, H2H 17%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, leak_free_reviews
- England - Premier League: 90 duels, vorm 98%, H2H 58%, inzetbewijs 2%, lekvrije reviews 100% (10/10), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds
- England - Championship: 7 duels, vorm 14%, H2H 43%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, leak_free_reviews
- France - Ligue 1: 81 duels, vorm 91%, H2H 72%, inzetbewijs 1%, lekvrije reviews 100% (9/9), stats 100%; gaten: confirmed_lineups, timestamped_odds, goal_timeline
- France - Ligue 2: 81 duels, vorm 63%, H2H 46%, inzetbewijs 9%, lekvrije reviews 100% (9/9), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds
- Europe - Champions League: 14 duels, vorm 43%, H2H 50%, inzetbewijs 0%, lekvrije reviews 100% (7/7), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds
- Europe - Europa League: 51 duels, vorm 18%, H2H 37%, inzetbewijs 0%, lekvrije reviews 100% (10/10), stats 68%; gaten: form, h2h, confirmed_lineups, timestamped_odds, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Conference League: 133 duels, vorm 17%, H2H 26%, inzetbewijs 0%, lekvrije reviews 100% (35/35), stats 65%; gaten: form, h2h, confirmed_lineups, timestamped_odds, post_match_statistics, referee, goal_timeline, card_timeline

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
