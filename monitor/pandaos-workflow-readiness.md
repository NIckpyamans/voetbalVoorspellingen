# PandaOS Workflow Readiness

Gegenereerd: 2026-06-19T09:49:36.730Z

## Conclusie
PandaOS is vooral nuttig als lokale workflow-orchestrator. Voor deze app passen we hetzelfde principe toe via herbruikbare monitorchecks, projectgeheugen en een centrale prioriteitenlijst.

## Status
- Acties totaal: 26
- Hoge prioriteit: 9
- Widgetstatus: ok
- Datacompleetheid: 50%
- H2H-dekking: 100%
- Prediction snapshots: 619

## Topprioriteiten
1. Prediction quality gate actief (high) - Vul eerst H2H, vorm, actuele standen, xG/shotdata en marktdekking voordat top-5 picks zwaar meetellen.
2. Modelkalibratie (high) - Gebruik deze score om ensemble- en closing-gewichten te blijven finetunen.
3. Top faalsignaal (high) - Gebruik dit signaal om de modelweging of brondekking gericht te verbeteren.
4. Modelen zitten te vaak uit elkaar (high) - De eerste penalty is geinstalleerd. Heropen alleen als dit signaal na nieuwe reviews blijft oplopen.
5. Datakwaliteit kritisch (high) - Los eerst ontbrekende eindstanden of corrupte scores op voordat modelwegingen opnieuw worden aangescherpt.
6. Bevestigde opstellingen (high) - Blijf lineups vlak voor kickoff verversen; open lineups blijven confidence-penalty en faalsignaal.
7. Historische scheidsprofielen (high) - Breid referee aliasen en football-data.co.uk archieven per competitiefamilie uit.
8. Model presteert onder de competitie-baseline voor competition:competition-belgium-l1|model:v23-calibrated-odds-ledger. (high) - Model presteert onder de competitie-baseline voor competition:competition-belgium-l1|model:v23-calibrated-odds-ledger.
9. Model presteert onder de competitie-baseline voor competition:competition-europe-champions-league|model:v23-calibrated-odds-ledger. (high) - Model presteert onder de competitie-baseline voor competition:competition-europe-champions-league|model:v23-calibrated-odds-ledger.
10. Top 5 zekere tips monitoren (medium) - Nieuwe selectie wordt bewaakt; pas opnieuw bij voldoende nieuwe reviewdata.
11. H2H-signaal herwegen (medium) - Gebruik H2H alleen zwaar als het recent, voldoende gevuld en competitietype-vergelijkbaar is.
12. ClubElo interlands strakker scheiden (medium) - Splits interland- en clubkracht nog strakker en temper ClubElo bij nationale teams.

## Aanbevolen workflow
- Run npm run monitor:health, monitor:widgets, monitor:data-quality en monitor:regressions als vaste pre-deploy workflow.
- Gebruik deze readiness-output als projectgeheugen voor de volgende verbetercyclus.
- Koppel PandaOS pas direct wanneer er een publieke API, widgetmanifest of desktop connector beschikbaar is.
