# PandaOS Workflow Readiness

Gegenereerd: 2026-08-31T06:46:29.583Z

## Conclusie
PandaOS is vooral nuttig als lokale workflow-orchestrator. Voor deze app passen we hetzelfde principe toe via herbruikbare monitorchecks, projectgeheugen en een centrale prioriteitenlijst.

## Status
- Acties totaal: 27
- Hoge prioriteit: 7
- Widgetstatus: degraded
- Datacompleetheid: 89%
- H2H-dekking: 25%
- Prediction snapshots: 5000

## Topprioriteiten
1. Modelkalibratie (high) - Gebruik deze score om ensemble- en closing-gewichten te blijven finetunen.
2. Modelen zitten te vaak uit elkaar (high) - De eerste penalty is geinstalleerd. Heropen alleen als dit signaal na nieuwe reviews blijft oplopen.
3. Bevestigde opstellingen (high) - Projected XI is gevuld; vervang vlak voor kickoff door bevestigde opstellingen zodra live bron bereikbaar is.
4. Historische scheidsprofielen (high) - Breid referee aliasen en football-data.co.uk archieven per competitiefamilie uit.
5. Blessures/schorsingen (high) - Gebruik Sofascore spelersstatus eerst, daarna Transfermarkt/football-data.org squad fallback met veilige team-id mapping.
6. Model presteert onder de competitie-baseline voor competition:competition-belgium-l1|model:v23-calibrated-odds-ledger. (high) - Model presteert onder de competitie-baseline voor competition:competition-belgium-l1|model:v23-calibrated-odds-ledger.
7. Model presteert onder de competitie-baseline voor competition:competition-europe-champions-league|model:v23-calibrated-odds-ledger. (high) - Model presteert onder de competitie-baseline voor competition:competition-europe-champions-league|model:v23-calibrated-odds-ledger.
8. H2H aanvullen (medium) - Voeg waar mogelijk extra competitie-backfill of bronfallback toe in de worker.
9. H2H fallback verbreden (medium) - Blijf competitiebackfill combineren met neutrale onderlinge fallback buiten de live bron.
10. Top 5 zekere tips monitoren (medium) - Nieuwe selectie wordt bewaakt; pas opnieuw bij voldoende nieuwe reviewdata.
11. H2H-signaal herwegen (medium) - Gebruik H2H alleen zwaar als het recent, voldoende gevuld en competitietype-vergelijkbaar is.
12. ClubElo interlands strakker scheiden (medium) - Splits interland- en clubkracht nog strakker en temper ClubElo bij nationale teams.

## Aanbevolen workflow
- Run npm run monitor:health, monitor:widgets, monitor:data-quality en monitor:regressions als vaste pre-deploy workflow.
- Gebruik deze readiness-output als projectgeheugen voor de volgende verbetercyclus.
- Koppel PandaOS pas direct wanneer er een publieke API, widgetmanifest of desktop connector beschikbaar is.
