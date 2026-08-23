# Prediction decision objective

## Productdoel

De app helpt een gebruiker voetbalwedstrijden onderbouwd te beoordelen. De Top 5 toont de sterkste voorspellingen van de dag, maar noemt een wedstrijd alleen inzetbaar wanneer de volledige datagate slaagt. Een voorspelling blijft altijd een kansinschatting en nooit een garantie op winst of een exacte uitslag.

## Voor de wedstrijd

De worker probeert uiterlijk in de vensters T-75, T-45 en T-20 vast te leggen:

- fixture, aftraptijd, competitie en teamidentiteit;
- laatste vijf en tien wedstrijden, thuis-/uitvorm en tegenstandersterkte;
- maximaal vijf relevante en recente H2H-wedstrijden;
- stand, xG/shots, blessures, schorsingen en verwachte opstelling;
- bevestigde opstelling met eerste bevestigingstimestamp;
- opening-, prematch- en closing odds als afzonderlijke immutable captures;
- bron, brontimestamp, modelversie en featurehash van de voorspelling.

## Inzetbaarheidscontract

Een Top-5-pick krijgt alleen `Inzetbaar volgens datagate` wanneer:

- datacompleetheid minimaal 70% is;
- de kwaliteitsgate hoge zekerheid niet blokkeert;
- beide opstellingen bevestigd zijn;
- complete actuele 1X2-odds beschikbaar zijn;
- de competitie minimaal 30 lekvrije evaluaties heeft;
- de historische 1X2-hitrate van die competitie minimaal 55% is;
- de modelkans minimaal drie procentpunt boven de genormaliseerde marktinschatting ligt;
- het geen oefenwedstrijd of reeds gespeelde wedstrijd is.

Zolang een voorwaarde ontbreekt, toont de kaart `Volgen - nog niet inzetten` of `Analyse - geen inzetadvies` met de concrete blokkades.

## Na de wedstrijd

De resultaatworker vult waar de bron dit betrouwbaar publiceert alsnog aan:

- eindstand en ruststand;
- doelpunten en minuutsegmenten;
- schoten, schoten op doel, xG, balbezit en grote kansen;
- corners, kaarten, overtredingen en scheidsrechter;
- daadwerkelijk gebruikte opstelling en wissels;
- post-match review, foutmarge, Brier score en log loss;
- model-, team-, competitie- en fasekalibratie.

Ontbrekende opening-, prematch- of closing odds worden nooit achteraf verzonnen. Historische marktdata mag alleen als afzonderlijk gelabelde kalibratiebron worden gebruikt.

## Succesmeting

De primaire KPI is gekalibreerde 1X2-nauwkeurigheid op lekvrije voorspellingen. Exact-score hitrate, gemiddelde doelpuntenfout, CLV en ROI zijn secundair en worden alleen gepubliceerd wanneer de benodigde steekproef en timestampdekking voldoende zijn.
