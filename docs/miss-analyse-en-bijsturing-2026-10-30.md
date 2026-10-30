# Achteraf oordelen: analyse-bot, datakwaliteit en bijsturing per competitie

Datum: 30 oktober 2026

Dit document beschrijft de lus die na elke speelronde draait: wat er per
voorspelling wordt vastgelegd, hoe de analyse-bot de misses per competitie
beoordeelt, en hoe een voorstel wel of niet werkelijkheid wordt.

## 1. Wat er per voorspelling wordt opgeslagen

De compacte opslag (`data/match-store.json`, gebouwd uit de reviews) bewaart per
wedstrijd naast de uitslag ook de omstandigheden waaronder is voorspeld:

| veld | inhoud |
| --- | --- |
| `po` / `ao` / `hit` / `ex` / `ge` | voorspelde uitkomst, werkelijke uitkomst, 1X2-hit, exacte hit, doelpuntfout |
| `cf` | zekerheid van de eigen pick |
| `mp` | gede-vigde marktkansen (alleen als de odds aantoonbaar vóór aftrap zijn vastgelegd) |
| `mk` / `mh` | marktfavoriet en of die uitkwam |
| `ll` / `bs` | logloss en Brier van de voorspelling |
| `dq.cs` | datacompleetheid bij de voorspelling (0–1) |
| `dq.mi` | aantal ontbrekende bronvelden |
| `dq.sf` | sufficiency-status: `voldoende`, `beperkt`, `onvoldoende`, `onbekend` |
| `dq.od` | odds-status (`odds_missing`, `prematch`, ...) |
| `dq.h` / `dq.f` | odds-leeftijd in uren en de klasse (`fresh` < 6u, `recent` < 24u, `stale` < 72u, `old`) |
| `cp` | componentkansen per model: `[sleutel, actief, thuis, gelijk, uit]` |

Zo is van elke miss later te zien of er genoeg informatie was, welke odds er
lagen, en welk model er naast zat.

## 2. Sufficiency wordt nu altijd vastgelegd

`dataSufficiency` werd alleen bewaard als een snapshot het veld al meegaf; in de
praktijk stond het er dus nooit. `shared/dataSufficiency.js` leidt de status af
uit compleetheid, ontbrekende bronvelden, odds-status en odds-versheid, en
`scripts/worker/snapshot-review-materialization.js` gebruikt die afleiding
wanneer snapshot en review het veld missen. Een ontbrekend oordeel is expliciet
`onbekend` — nooit stilzwijgend "voldoende".

## 3. De analyse-bot

```
npm run monitor:miss-analysis        # node scripts/miss-review.js
```

Leest de opslag, evalueert elke beoordeelde wedstrijd en schrijft
`monitor/miss-analysis.json`. Per competitie (en voor het geheel) staan er:

- aantal beoordeelde duels, hits, misses, hitpercentage, exact-scorepercentage en
gemiddelde doelpuntfout;
- gemiddelde zekerheid bij een hit tegenover bij een miss, en het gat met de
  werkelijke hitrate;
- marktvergelijking: hoe vaak model en marktfavoriet het oneens waren en de markt
  toch gelijk had, plus logloss van model en markt op dezelfde duels;
- datakwaliteit: verdeling over de vier sufficiency-statussen, gemiddelde
  compleetheid (ook op misses), gemiddeld aantal ontbrekende bronnen, aandeel
  missers zonder volledige invoer en aandeel gedateerde odds;
- per component hoe vaak die op een miss de juiste kant had;
- één voorstel met bewijs en confidence.

De voorstellen komen uit een vaste, uitlegbare volgorde:

1. `data-eerst` — de meeste misses hadden geen volledige invoer: eerst bronnen
   repareren, niet aan gewichten sleutelen.
2. `marktgewicht-omhoog` — de markt had vaak gelijk waar het model afweek.
3. `zekerheid-temper` — het model is bij een miss even stellig als bij een hit.
4. `component-herwegen` — één component had op de misses vaak de juiste kant.
5. `geen-bijsturing` / `te-weinig-data`.

Alles is per competitie, omdat het model per competitie verschillend presteert;
één globaal marktgewicht is aantoonbaar te grof.

**De bot past niets toe.** `applied: false` staat expliciet in het rapport. Een
voorstel wordt pas werkelijkheid via de bestaande poorten: de holdout-poort van
`shared/ensembleWeightFit.js`, `shared/calibrationFit.js`, of een handmatige
databron-reparatie.

## 4. Marktgewicht: alleen odds die iets over het duel wisten

`shared/ensembleWeightFit.js` laat records met odds ouder dan 72 uur (of klasse
`old`) niet meer meewegen in de fit. Het rapport telt ze als `droppedStaleOdds`,
zodat de steekproef niet groter lijkt dan de data die de fit werkelijk droeg.
Records zonder vastgelegde odds-versheid (marktkansen uit het marktbestand)
blijven staan; daar is niets gemeten en dus niets te verwerpen.

## 5. Clubbot: ablatimeting, pre-geregistreerd, zonder live-effect

`scripts/backtest-strength-model.js` vergelijkt walk-forward het clubsterktemodel
met dezelfde Poisson-motor zonder teamsterktes (aanval/verdediging = 1). Dat is
de ablatie: het verschil tussen beide is de meerwaarde van de clubsterktes zelf.
Het rapport bevat nu een `preregistration`-blok met hypothese, primaire metriek,
minimum-effect (0,002 logloss) en beslisregel, vastgelegd vóór de uitslag wordt
gelezen. Het verdict kent daarom ook `geen-verschil`.

De live worker gebruikt het sterkte-model niet bij de voorspelling, dus deze
meting heeft geen live-effect. `npm run model:backtest:strength`.

## 6. Live worker leest dezelfde historie

`scripts/publish-match-store.js` schrijft store, index en manifest naar R2.
`shared/matchStoreRemote.js` leest ze terug en weigert objecten die niet bij het
manifest passen; `scripts/worker/match-store-history.js` bouwt daar de clubvorm
uit en de worker gebruikt die in de voorspelling. Voorspelling en analyse kijken
dus naar dezelfde historie.

## 7. Waar het draait

`.github/workflows/match-store.yml` draait na elke worker-, evaluatie- en
enrichment-run: reviews materialiseren, opslag bouwen en verifiëren,
clubanalyse, modelrapport, marktgewicht-fit, sterkte-backtest, de analyse-bot en
daarna publicatie naar R2. De rapporten worden gecommit; een ontbrekend of
verouderd rapport maakt de run rood.
