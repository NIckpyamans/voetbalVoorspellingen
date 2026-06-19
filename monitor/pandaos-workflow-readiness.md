# PandaOS Workflow Readiness

Gegenereerd: 2026-06-19T10:56:28.803Z

## Conclusie
PandaOS is vooral nuttig als lokale workflow-orchestrator. Voor deze app passen we hetzelfde principe toe via herbruikbare monitorchecks, projectgeheugen en een centrale prioriteitenlijst.

## Status
- Acties totaal: 24
- Hoge prioriteit: 6
- Widgetstatus: ok
- Datacompleetheid: 66%
- H2H-dekking: 100%
- Prediction snapshots: 1184

## Topprioriteiten
1. Modelkalibratie (high) - Gebruik deze score om ensemble- en closing-gewichten te blijven finetunen.
2. Top faalsignaal (high) - Gebruik dit signaal om de modelweging of brondekking gericht te verbeteren.
3. Modelen zitten te vaak uit elkaar (high) - De eerste penalty is geinstalleerd. Heropen alleen als dit signaal na nieuwe reviews blijft oplopen.
4. Bevestigde opstellingen (high) - Projected XI is gevuld; vervang vlak voor kickoff door bevestigde opstellingen zodra live bron bereikbaar is.
5. Model presteert onder de competitie-baseline voor competition:competition-belgium-l1|model:v23-calibrated-odds-ledger. (high) - Model presteert onder de competitie-baseline voor competition:competition-belgium-l1|model:v23-calibrated-odds-ledger.
6. Model presteert onder de competitie-baseline voor competition:competition-europe-champions-league|model:v23-calibrated-odds-ledger. (high) - Model presteert onder de competitie-baseline voor competition:competition-europe-champions-league|model:v23-calibrated-odds-ledger.
7. Top 5 zekere tips monitoren (medium) - Nieuwe selectie wordt bewaakt; pas opnieuw bij voldoende nieuwe reviewdata.
8. H2H-signaal herwegen (medium) - Gebruik H2H alleen zwaar als het recent, voldoende gevuld en competitietype-vergelijkbaar is.
9. ClubElo interlands strakker scheiden (medium) - Splits interland- en clubkracht nog strakker en temper ClubElo bij nationale teams.
10. Vul gratis pre-match odds snapshots voordat ROI/CLV wordt beoordeeld. (medium) - Vul gratis pre-match odds snapshots voordat ROI/CLV wordt beoordeeld.
11. Prioriteer open bronconflicten op impact en providertrust. (medium) - Prioriteer open bronconflicten op impact en providertrust.
12. Resultaatbackfill is schoon binnen de auditperiode. (medium) - Resultaatbackfill is schoon binnen de auditperiode.

## Aanbevolen workflow
- Run npm run monitor:health, monitor:widgets, monitor:data-quality en monitor:regressions als vaste pre-deploy workflow.
- Gebruik deze readiness-output als projectgeheugen voor de volgende verbetercyclus.
- Koppel PandaOS pas direct wanneer er een publieke API, widgetmanifest of desktop connector beschikbaar is.
