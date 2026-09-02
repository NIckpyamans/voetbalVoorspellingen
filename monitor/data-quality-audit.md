# Data Quality Audit

Laatst bijgewerkt: 2026-09-02T07:24:14.564Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 738
- Oude wedstrijden: 333
- Pending result backfills: 2
- Ontbrekende oude scores: 0
- H2H-dekking: 40%
- Reviews na afloop: 14%
- Lekvrije post-matchreviews: 67% (2/3)
- Immutable snapshot-evaluaties: 65% (15/23)
- Bruikbare wedstrijdstatistieken: 80%
- Bevestigde opstellingen: 12%
- Historisch teruggevonden basiselftallen: 60%
- Verse getimestampte prematch-odds: 4%
- Volledige pre-match bewijsset: 2%
- Doelpunten met tijdlijn: 61%
- Kaarten met tijdlijn: 63%

## Per competitie
- Netherlands - Eredivisie: 20 duels, vorm 80%, H2H 35%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, card_timeline
- Netherlands - Eerste Divisie: 113 duels, vorm 33%, H2H 9%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 76 duels, vorm 92%, H2H 53%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 77%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Germany - 2. Bundesliga: 21 duels, vorm 71%, H2H 24%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Premier League: 90 duels, vorm 98%, H2H 56%, inzetbewijs 2%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 45 duels, vorm 20%, H2H 51%, inzetbewijs 18%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 82 duels, vorm 89%, H2H 71%, inzetbewijs 1%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 81 duels, vorm 59%, H2H 49%, inzetbewijs 9%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Champions League: 26 duels, vorm 62%, H2H 27%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 51 duels, vorm 18%, H2H 37%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 66%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline
- Europe - Conference League: 133 duels, vorm 17%, H2H 26%, inzetbewijs 0%, lekvrije reviews 67% (2/3), stats 66%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline

## Aanbevelingen
- Vul eerst betrouwbare eindstanden aan voordat learning en ROI/CLV zwaarder worden gewogen.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Evalueer minimaal 95% van de 23 geldige immutable snapshots voordat opnieuw wordt gekalibreerd.
- Post-match statistiekdekking is voldoende.
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
