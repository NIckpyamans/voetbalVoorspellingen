# Code-audit 28 oktober 2026 — fouten, vijf aanpassingen en onderzoek

Dit document hoort bij de commit-reeks op `review/code-audit-2026-10-28` (PR #35).
De lokale shell is geblokkeerd (EPERM), dus de CI-poort (typecheck + alle
unit-tests) is de testbasis. Wat hier staat is door die poort getest, niet
handmatig in een terminal.

## 1. Gevonden fouten

| # | Fout | Gevolg | Herstel |
|---|---|---|---|
| 1 | `normalise` in `shared/marketBenchmark.js` zette elke kans op minimaal `EPS` | Een perfecte voorspelling `[1,0,0]` scoorde niet nul op Brier en RPS, maar ±5e-11. De unit-test legde dat bloot. | Nullen blijven nul; alleen `logLoss3` klemt zijn eigen waarde tegen `EPS`. |
| 1b | `rps3` trok per stap 1 af in plaats van de cumulatieve uitkomst te gebruiken | `[1,0,0]` op H scoorde 0,5 in plaats van 0; elke RPS-vergelijking met de markt was te hoog. | Cumulatieve voorspelling minus cumulatieve uitkomst, zoals de definitie van RPS. |
| 1c | De test bij de power-de-vig verwachtte dat de favoriet daalt | Power haalt de marge bij de outsiders weg, dus de favoriet stijgt; de oude assertie was wiskundig onjuist. | Assertie en toelichting kloppen nu met de methode. |
| 2 | `oddsFreshnessGate(null)` gaf `usable: true` | Een quotering zonder tijdstip kwam door de poort met gewicht 0,5, terwijl de reden al zei dat er geen betrouwbaar tijdstip was. | `unknown` is nooit bruikbaar, ongeacht het gewicht. |
| 3 | Onmogelijke records konden de historie in | Negatieve score, ongeldige datum of een team tegen zichzelf telt mee in het sterktenmodel, de kalibratie en de clubanalyse. | `shared/matchStoreIntegrity.js` verwijdert zulke records, herstelt `y`/`ao` uit de doelpunten en herrekent `hit`. De build rapporteert de aantallen. |
| 4 | Het marktdeel van het live-ensemble behandelde oude odds als closing odds | Odds van vier dagen voor aftrap kregen hetzelfde gewicht (0,16) als odds van twee uur voor aftrap. | De versheidsklasse schaalt het marktgewicht (1 → 0,85 → 0,55 → 0,25) en ook de markt-shrink. |
| 5 | De Dixon-Coles-`rho` stond vast op −0,06 | De belangrijkste aanname in het doelpuntenmodel was niet gemeten op eigen historie. | De backtest meet nu dezelfde walk-forward-duels voor een reeks rho's en rapporteert de beste op logloss. |

## 2. De vijf doorgevoerde aanpassingen

1. **Kansniveau-scores exact** (`shared/marketBenchmark.js`, `tests/unit/market-benchmark.test.js`).
   Brier en RPS zijn nu exact nul bij een perfecte voorspelling en blijven
   eindig bij een lege verdeling. Zonder dit was elke vergelijking met de markt
   een paar duizendsten scheef.
2. **Odds-poort dicht bij onbekend tijdstip** (`shared/oddsFreshness.js`, getest).
   Wie niet kan aantonen dat de odds vóór aftrap zijn vastgelegd, levert geen
   bewezen marktsignaal.
3. **Opslagintegriteit** (`shared/matchStoreIntegrity.js`, `scripts/build-match-store.js`,
   `tests/unit/match-store-integrity.test.js`). De compacte opslag is de basis
   van alle analyses; één onmogelijk record vergiftigt het sterktenmodel. De
   build schrijft nu alleen gezuiverde records en meldt wat er wegviel.
4. **Versheidsweging in het live-ensemble** (`scripts/worker/outcome-ensemble.js`,
   `tests/unit/outcome-ensemble.test.js`). Het marktgewicht en de markt-shrink
   volgen de leeftijd van de quotering; de ensembleversie is naar `v4` gegaan
   zodat de ledger laat zien welke berekening is gebruikt.
5. **Rho-sweep in de backtest** (`scripts/backtest-strength-model.js`,
   `.github/workflows/match-store.yml`). De workflow meet de clubsterktes elke
   ronde chronologisch en schrijft `monitor/strength-backtest.json`, inclusief
   `rhoSweep` en `bestRho`. Geen poort: een slechtere meting mag de opslag niet
   blokkeren, maar moet wel zichtbaar zijn.

## 3. Onderzoek: wat helpt aantoonbaar (2023–2026)

- **Dixon-Coles met tijdsverval is de sterkste gratis basis.** Een walk-forward
  studie uit 2026 over 8.483 voorspellingen in vijf competities meldt logloss
  1,001 en Brier 0,597 voor Dixon-Coles, tegen 1,017/0,609 voor een eenvoudig
  xG-model. Ons model doet dat al (tijdsverval + lage-uitslagen-correctie), maar
  de rho was niet gemeten — vandaar aanpassing 5.
- **De markt blijft scherper dan welk model dan ook.** Dezelfde studie: Pinnacle
  closing odds 0,969 logloss en 0,576 Brier. Ons ensemble geeft de markt 0,16
  gewicht (≈12% na hernormalisatie). Dat is een prior, geen meting. De volgende
  stap is het gewicht chronologisch fitten in plaats van vastzetten.
- **Rapporteer logloss én Brier, niet alleen RPS.** RPS onderscheidt kleine
  modelverschillen minder goed dan logloss/Brier. Het modelrapport doet dat al;
  RPS blijft als tweede maat.
- **Kalibratie vraagt een onafhankelijk venster.** Isotonic overfit onder roughly
  1.000 voorbeelden. `selectCalibration` valt daarom terug op `identity` onder
  150 beoordeelde voorspellingen en meet op een chronologische holdout van 40%.
- **AI-bots: geen bewijs dat ze het model beter maken.** Er is geen publicatie
  die aantoont dat LLM-output als feature een statistisch model verbetert. Wat
  er wel is: LLM-SoccerArena (2026) laat zien dat webtoegang de Brier van
  LLM-voorspellingen met 0,023 verbetert. Dat is een benchmark voor LLM's, geen
  bewijs voor een feature. Een clubbot hoort daarom pas in het ensemble als de
  output vóór aftrap wordt vastgelegd en met een ablatie is gemeten.
- **Gratis data**: football-data.co.uk (resultaten + odds), OpenFootball
  (fixtures/resultaten, publiek domein) en StatsBomb Open Data (events, alleen
  geselecteerde competities en met attributie).

Bronnen: [walk-forward vergelijking 2026](https://github.com/asiyetajwa/calibrating-expected-goals/blob/main/manuscript.md),
[scikit-learn kalibratie](https://scikit-learn.org/stable/modules/calibration.html),
[RPS-kritiek 2025](https://pena.lt/y/2025/05/01/better-metrics-for-football-forecasts-moving-beyond-the-ranked-probability-score/),
[LLM-SoccerArena](https://arxiv.org/html/2607.24573v1).

## 4. Wat dit nog niet oplost

1. **De ensemblegewichten zijn een prior.** 0,37 / 0,22 / 0,14 / 0,16 is nooit op
   eigen historie gefit. Nodig: per wedstrijd de componentkansen bewaren, dan
   op een vroeg seizoen fitten en op een later seizoen toetsen.
2. **De compacte opslag is nog niet de bron van de live worker.** De worker leest
   R2/Neon; de store wordt in de repo gebouwd. Publiceren naar R2 en daar lezen
   maakt de voorspelling sneller en consistenter met de analyses.
3. **De rho-sweep heeft pas betekenis vanaf ±250 opgeslagen wedstrijden.** Tot
   die tijd meldt de backtest `te-weinig-wedstrijden`.
4. **Een clubbot is een experiment, geen verbetering.** Alleen met
   pre-registratie, vastlegging vóór aftrap en een ablatie tegen het model
   zonder bot-output.
