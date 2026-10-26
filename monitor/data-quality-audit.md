# Data Quality Audit

Laatst bijgewerkt: 2026-10-26T13:09:55.827Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 519
- Oude wedstrijden: 283
- Pending result backfills: 0
- Ontbrekende oude scores: 41
- H2H-dekking: 35%
- Reviews na afloop: 57%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 519/503
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 86%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 79%
- Verse getimestampte prematch-odds: 13%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 82%
- Kaarten met tijdlijn: 85%

## Per competitie
- Netherlands - Eredivisie: 36 duels, vorm 100%, H2H 67%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 48 duels, vorm 100%, H2H 21%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 36 duels, vorm 100%, H2H 69%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- Germany - 2. Bundesliga: 36 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 83%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- England - Premier League: 40 duels, vorm 100%, H2H 60%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 73 duels, vorm 100%, H2H 30%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 36 duels, vorm 100%, H2H 83%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 88%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, goal_timeline
- France - Ligue 2: 36 duels, vorm 100%, H2H 58%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 56%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Europe - Champions League: 57 duels, vorm 95%, H2H 2%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 84%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 64 duels, vorm 88%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 71%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Europe - Conference League: 57 duels, vorm 68%, H2H 2%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 63%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline

## Aanbevelingen
- Vul eerst betrouwbare eindstanden aan voordat learning en ROI/CLV zwaarder worden gewogen.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Evalueer minimaal 95% van de 0 geldige immutable snapshots voordat opnieuw wordt gekalibreerd.
- Post-match statistiekdekking is voldoende.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Samples
- Score mist: 2026-10-15: CSKA Sofia - AS Monaco
- Score mist: 2026-10-15: Universitatea Craiova - Getafe
- Score mist: 2026-10-15: Egnatia - FC Midtjylland
- Score mist: 2026-10-15: Lugano - FK Crvena Zvezda
- Score mist: 2026-10-15: Hajduk Split - Ajax Amsterdam
- Score mist: 2026-10-15: KAA Gent - AGF
- Score mist: 2026-10-15: KuPS - Trabzonspor
- Score mist: 2026-10-15: Mjällby - Inter Club d'Escaldes
- Score mist: 2026-10-15: Panathinaikos - Borac Banja Luka
- Score mist: 2026-10-15: Riga FC - Kairat Almaty
- Score mist: 2026-10-15: Atalanta - Pafos
- Score mist: 2026-10-15: Brighton & Hove Albion - Kauno Zalgiris
- Score mist: 2026-10-15: F.C. København - Braga
- Score mist: 2026-10-15: FC Twente - FC Thun
- Score mist: 2026-10-15: Heart of Midlothian - FC Nordsjælland
- Score mist: 2026-10-15: SC Freiburg - Jablonec
- Score mist: 2026-10-15: St.Truiden - Iberia 1999
- Score mist: 2026-10-15: Brann - Lincoln Red Imps FC
- Score mist: 2026-10-15: AZ Alkmaar - Hapoel Be'er
- Score mist: 2026-10-15: Lech Poznan - Bayer Leverkusen
- H2H mist: 2026-10-13: Bristol City - Blackburn Rovers
- H2H mist: 2026-10-13: Burnley - Charlton Athletic
- H2H mist: 2026-10-13: Cardiff City - Watford
- H2H mist: 2026-10-13: Millwall - Swansea City
- H2H mist: 2026-10-13: Wolverhampton Wanderers - Bolton Wanderers
- H2H mist: 2026-10-13: Wrexham - West Bromwich Albion
- H2H mist: 2026-10-13: Birmingham City - Preston North End
- H2H mist: 2026-10-13: Stoke City - Middlesbrough
- H2H mist: 2026-10-13: Lens - Sporting CP
- H2H mist: 2026-10-13: Sabah FK - Slavia Prague
