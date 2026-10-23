# Data Quality Audit

Laatst bijgewerkt: 2026-10-23T08:00:11.635Z
Lookback: 45 dagen

## Scores
- Wedstrijden: 588
- Oude wedstrijden: 286
- Pending result backfills: 0
- Ontbrekende oude scores: 41
- H2H-dekking: 30%
- Reviews na afloop: 56%
- Lekvrije post-matchreviews: 0% (0/0)
- Immutable snapshot-evaluaties: 0% (0/0 unieke fixtures)
- Snapshotrijen / unieke fixtures: 708/545 (163 herhaalde rijen)
- Dagbestandwedstrijden / unieke fixtures: 588/572
- Auditstatus freshness: fresh
- Bruikbare wedstrijdstatistieken: 85%
- Bevestigde opstellingen: 0%
- Historisch teruggevonden basiselftallen: 63%
- Verse getimestampte prematch-odds: 10%
- Volledige pre-match bewijsset: 0%
- Doelpunten met tijdlijn: 82%
- Kaarten met tijdlijn: 82%

## Per competitie
- Netherlands - Eredivisie: 45 duels, vorm 100%, H2H 51%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Netherlands - Eerste Divisie: 50 duels, vorm 98%, H2H 8%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - Bundesliga: 45 duels, vorm 100%, H2H 56%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Germany - 2. Bundesliga: 45 duels, vorm 100%, H2H 49%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 78%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- England - Premier League: 50 duels, vorm 100%, H2H 52%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- England - Championship: 85 duels, vorm 100%, H2H 17%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 100%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 1: 45 duels, vorm 100%, H2H 80%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 89%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- France - Ligue 2: 45 duels, vorm 100%, H2H 51%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 39%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Europe - Champions League: 57 duels, vorm 95%, H2H 2%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 84%; gaten: h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews
- Europe - Europa League: 64 duels, vorm 86%, H2H 0%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 71%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, goal_timeline, card_timeline
- Europe - Conference League: 57 duels, vorm 63%, H2H 2%, inzetbewijs 0%, lekvrije reviews 0% (0/0), stats 63%; gaten: form, h2h, confirmed_lineups, timestamped_odds, immutable_snapshot_windows, leak_free_reviews, post_match_statistics, referee, goal_timeline, card_timeline

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
- H2H mist: 2026-10-09: Almere City - FC Eindhoven
- H2H mist: 2026-10-09: De Graafschap - Jong FC Utrecht
- H2H mist: 2026-10-09: FC Dordrecht - FC Emmen
- H2H mist: 2026-10-09: Heracles Almelo - RKC Waalwijk
- H2H mist: 2026-10-09: Jong Ajax - VVV-Venlo
- H2H mist: 2026-10-09: Jong AZ - FC Den Bosch
- H2H mist: 2026-10-09: NAC Breda - MVV Maastricht
- H2H mist: 2026-10-09: Roda JC Kerkrade - Jong PSV
- H2H mist: 2026-10-09: TOP Oss - Helmond Sport
- H2H mist: 2026-10-09: Sochaux - Boulogne
