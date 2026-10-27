# Verslag: voetbalvoorspellingen (kansen, bedreigingen en verbeterlijst)

Bron: repository `NIckpyamans/voetbalVoorspellingen` en de bestaande analyse `voetbalvoorspellingen-analyse.md`. Cijfers komen uit `data/meta.json` (laatste worker-run, versie `v25-club-rating`, 1819 reviews).

## 1. Samenvatting

Het systeem combineert meerdere modellen tot één voorspelling per wedstrijd: Dixon-Coles/Poisson, een feature-score model, Monte Carlo, een ClubElo-achtig model, een de-vig marktmodel en enkele extra signalen (opstelling, selectie, twee-benen-context). De onderliggende methode is solide, maar de meting laat zien dat de voorspellingen nog niet dicht bij de werkelijke uitslagen liggen.

Belangrijkste meetresultaten over 1819 reviews:

| Maatstaf | Waarde | Oordeel |
|---|---|---|
| Exacte score correct | 9,5% | Laag; een vaste gok op 1-1 of 1-0 haalt vergelijkbare percentages |
| Uitkomst 1X2 correct | 44,5% | Matig; een marktfavoriet-strategie is doorgaans sterker |
| Uitkomst bij kansmodel (hoogste kans) | 46,8% | Matig |
| Gemiddelde doelpuntfout | 1,72 | Hoog |
| Kalibratie | "zwak", gemiddelde absolute fout 0,19 | Probleem: kansen kloppen niet met de werkelijkheid |

De kern van het probleem is kalibratie. Voorspellingen met 55–65% zekerheid kwamen in de praktijk slechts 38% uit. Voorspellingen boven 75% kwamen 39% uit. Het model is dus systematisch te zeker van zichzelf, terwijl de kansen in de lage klasse (onder 45%) juist te laag zijn ingeschat.

## 2. Wat er goed werkt

- **Modelarchitectuur**: meerdere onafhankelijke modellen, samengevoegd met gewichten en een marktcorrectie. Dat is de juiste opzet.
- **Markt als anker**: het de-vig marktmodel is het enige onderdeel dat de werkelijke vraagprijs van de wedstrijd meeneemt. Dat hoort zwaar te wegen.
- **Meetinfrastructuur**: er worden reviews, drift-alarmen, kalibratiebuckets en regressie-checks opgeslagen. Dit is zeldzaam en maakt gericht verbeteren mogelijk.
- **Versiebeheer van modellen**: per versie wordt de trefkans vastgelegd (`v23`, `v24`, `v25`). Hierdoor zie je dat `v25-club-rating` op 1X2 beter scoort (51,4%) dan `dixon-coles-poisson` (40,8%).

## 3. Diagnose per onderdeel

### 3.1 Kalibratie (grootste kans)
Het model geeft te veel gewicht aan extreme kansen. Dit is het meest oplosbare probleem. Een kalibratiestap (Platt-schaling of isotone regressie) op historische uitkomsten kan de kansen eerlijker maken, zonder het model zelf aan te passen.

### 3.2 Gewichten van het ensemble
De gewichten staan vast in `scripts/worker/outcome-ensemble.js`:

- Dixon-Coles/Poisson: 0,37
- Feature-score model: 0,22
- Monte Carlo: 0,14
- De-vig markt: 0,16
- ClubElo: 0,05
- Bevestigde opstelling: 0,05

De overige componenten (squad, twee-benen-context, gradient boosting) staan in dezelfde tabel. Er is in de code geen aanwijzing dat deze gewichten met een optimalisatie op historische uitslagen zijn vastgesteld. Dat moet worden gecontroleerd, want het is een groot methodisch risico. Controleer of de gewichten bij normalisatie optellen tot 1, want een eerdere analyse noemde een som van ongeveer 1,36.

### 3.3 Zwakke invoerbronnen
De meeste extra signalen zijn op dit moment leeg of gedeeltelijk gevuld:

- H2H-dekking: 6% van de speeldag, en een regressietest faalt daarop (1 van 17).
- Bevestigde opstellingen: 0%.
- Scheidsrechterprofielen: 0%.
- Blessures/schorsingen: 0%.
- Understat en FBref (xG en schoten): 0% op de actuele speeldag.
- Tijdgestempelde odds: 16% van de wedstrijden.
- API-Football staat uit (`enabled: false`), Sofascore geeft 403.

Een model dat op lege velden rekent, geeft ruis. Het veld `h2h_signal` komt 286 keer terug als faalsignaal, en `low_model_agreement` 390 keer.

### 3.4 Resultaten per competitie
Het model presteert ongelijk per competitie. Enkele voorbeelden (1X2-trefkans):

- Eredivisie 52,7% en Eerste Divisie 55,9%, maar met weinig exacte treffers.
- Ligue 1 39,4% en Bundesliga 39,8%.
- Champions League 37,5% en Conference League 43,8%.
- Italië Serie A: exact 11,8%, maar kalibratie-afwijking hoog.

De data laat zien dat Champions League en Conference League de laagste exacte trefkans hebben (6,3% en 5,3%). Per competitie zijn de steekproeven vaak onder 150 evaluaties, waardoor de cijfers nog niet betrouwbaar zijn (`modelReady: false`).

### 3.5 Fase van het toernooi
Competitiewedstrijden: 44,9% op 1X2. Twee-benen knock-out: 44,0%. Beker: 47,1%, maar met slechts 5% exact. Wedstrijden zonder bekende fase (`unknown`, 263 reviews) hebben een exacte trefkans van 8%.

### 3.6 Clubanalyse (niet afgerond)
De opgeslagen wedstrijden staan in `data/history-summary.json`. Dat bestand is één regel van meerdere megabytes, waardoor zoekopdrachten geen bruikbare telling geven. Ook kon ik in deze sessie geen script draaien om per club te aggregeren. Daarom doe ik hier geen uitspraak over een rode draad per club. De aanbevolen aanpak: een klein script dat `postMatchReviews` leest en per thuis- en uitclub de trefkans (1X2), exacte trefkans en gemiddelde doelpuntfout telt, met een minimum van 8 wedstrijden per club.

## 4. Geprioriteerde verbeterlijst

Status per punt in deze sessie: alleen punt 7 heeft een uitvoerbaar hulpmiddel gekregen ([club-analysis.js](scripts/club-analysis.js)). De overige punten zijn analyse en nog niet uitgevoerd, omdat de terminal geblokkeerd was.

1. **Kalibreer de kansen (P0).** Voeg Platt-schaling of isotone regressie toe op de historische reviews. Meet daarna de kalibratiefout opnieuw. Dit levert naar verwachting het meeste op, zonder de modellen zelf te wijzigen.
2. **Maak de gewichten meetbaar (P0).** Leg vast hoe de gewichten zijn gekozen en controleer of ze optellen tot 1. Test daarna een gewichtenset via tijdsgewijze validatie (train op oudere, test op nieuwere wedstrijden).
3. **Vergelijk met een marktbaseline (P0).** Meet per competitie of het model de de-vig marktkansen verslaat. Als dat niet lukt, is het marktmodel de betere voorspeller en moet het zwaarder wegen.
4. **Vul of verwijder lege invoerbronnen (P1).** H2H, opstellingen, blessures en xG staan op 0% of bijna 0%. Een model dat op lege velden rekent, voegt ruis toe. Zet ontbrekende signalen op neutraal, of laat ze weg uit de berekening.
5. **Let op de datakwaliteit per wedstrijd (P1).** Tijdgestempelde odds zijn er maar bij 16% van de wedstrijden. Leg per voorspelling vast welke bron actueel was.
6. **Meet per competitie en per fase met voldoende steekproef (P1).** Onder 150 evaluaties per groep zijn de cijfers niet betrouwbaar. Bundel kleine competities of wacht op meer data.
7. **Rond de clubanalyse af (P2).** Het script [club-analysis.js](scripts/club-analysis.js) is geschreven en leest het JSON-bestand met `JSON.parse`, zodat zoekopdrachten niet meer nodig zijn. Draai het met `node scripts/club-analysis.js 8 15` vanaf de repository-root. Het markeert clubs die meer dan 15 procentpunten van het gemiddelde afwijken. Nog niet gedraaid.
8. **Gratis databronnen blijven leidend (P2).** Controleer per bron de licentie en stabiliteit, want sommige bronnen blokkeren (Sofascore geeft 403) of staan uit (API-Football).

## 5. Advies over een AI-bot per club

Een AI-bot die elke club analyseert kan nuttig zijn voor context: blessures, schorsingen, speelstijl en recente selectiewijzigingen. Dat zijn signalen die de cijfers nu missen. Er zijn wel twee voorwaarden:

- **Meet eerst.** Zonder vastgelegde uitkomst per voorspelling kun je niet zien of de bot helpt. Leg de bot-output vóór de wedstrijd vast, net als de huidige reviews.
- **Gebruik de output als feature, niet als eindoordeel.** Een taalmodel kan context geven, maar het ensemble moet de bijdrage per wedstrijd wegen en kalibreren. Anders wordt het een gok met een mooie uitleg.

## 6. Beperkingen van dit verslag

- Terminal-uitvoering was in deze sessie geblokkeerd, dus ik kon niets opnieuw draaien. De cijfers komen uit de eerder gelezen `meta.json` en de code.
- De clubanalyse en de rode draad per club zijn niet onderbouwd.
- De opmerking over de gewichtensom (1,36 in een eerdere analyse) is niet door mij gecontroleerd op de volledige code. Het is een punt om na te gaan.
- Ik heb geen wijzigingen aan de code gemaakt.
