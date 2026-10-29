# Marktgewicht, opslag en structuur — 28 oktober 2026

Vervolg op `docs/audit-2026-10-28-vervolg.md`. Dit document legt vast wat er na
die audit is aangepast, waarom, en wat er nog openstaat.

## 1. Structuur: één integriteitscontrole, niet twee

`shared/matchStore.js` bevatte de integriteitscontrole (`sanitizeMatchStore`),
maar er stond een tweede kopie in `shared/matchStoreIntegrity.js`. Twee kopieën
van dezelfde regel lopen vroeg of laat uiteen; dan vindt de build een record
geldig dat de rapportage afkeurt. De tweede module is nu een doorverwijzing naar
de enige implementatie, zodat bestaande imports blijven werken.

`scripts/verify-match-store.js` leest de controle nu rechtstreeks uit
`shared/matchStore.js`.

## 2. Het marktgewicht is geen aanname meer

Het ensemble geeft de markt een gewicht van 0,16. Dat getal was nooit gemeten.
`shared/ensembleWeightFit.js` meet het nu op de eigen opgeslagen wedstrijden:

```
p(gemengd) = (1 - w) * p(model) + w * p(markt)
```

- Per wedstrijd met een marktkans (`mp`) en de modelzekerheid van de eigen pick
  (`cf`) is dat één kans op de gekozen uitkomst; de logloss daarvan is de fout.
- De fit zoekt `w` op de eerste 70% op datum en toetst op de laatste 30%.
  Een gewicht dat alleen in-sample beter is, telt niet.
- Onder 150 gekoppelde duels geeft de fit geen advies (`te-weinig-paren`).
- `scripts/fit-market-weight.js` schrijft `monitor/market-weight-fit.json`;
  `scripts/model-report.js` neemt de meting op als `marketWeightFit`.
- `shared/ensembleWeightPolicy.js` laat de gemeten fit voorgaan op de
  kansniveau-benchmark, maar alleen wanneer de holdout de verbetering bevestigt.
- `fitMarketWeightByCompetition` fit bovendien per competitie, met vier remmen
  tegen overfitting: chronologische 70/30-splitsing per competitie, raster tot
  0,35, shrinkage halfweg naar de prior (0,16) en een holdout-poort (minimaal
  0,002 logloss beter dan de prior, anders valt de competitie terug op de
  prior). Dit zit in hetzelfde rapport als `marketWeightFitByCompetition` en in
  `monitor/market-weight-fit.json` als `byCompetition`.

**Beperking, bewust:** alleen de kans op de gekozen uitkomst wordt gemengd. De
massa op de andere twee uitkomsten staat niet in de compacte opslag (daar staat
alleen de marktverdeling). Dit is dus een partiële fit: streng genoeg om te
meten of de markt meer of minder gewicht verdient, niet om de hele verdeling te
herschrijven. Zodra de modelprobabiliteiten per wedstrijd worden bewaard, kan
dezelfde fit op de volledige verdeling.

## 3. De compacte opslag gaat naar R2

`shared/matchStoreRemote.js` legt de objectstructuur vast: `store.json`,
`index.json` en een `manifest.json` met de tellingen, de bronhash en de check dat
elke wedstrijd twee teamslots in de index heeft. `scripts/publish-match-store.js`
schrijft die objecten met de bestaande R2-ondertekening; zonder R2-secrets slaat
het script over in plaats van te falen.

Dat is de eerste helft van "de worker leest dezelfde historie als de analyses";
de tweede helft — de worker die dit object daadwerkelijk als bron gebruikt —
staat beschreven in §6.

## 4. De rapporten vertrouwen niet meer blind op het bestand

Voor de rapporten draaien, controleert `scripts/verify-match-store.js` of de
opslag bij de brondata hoort (bronhash), of de index de opslag dekt, en of er
geen ongeldige records in staan. Bij een afwijking stopt de workflow met
exitcode 1. Zonder die poort rapporteren clubanalyse en modelrapport over een
historie die niet meer bestaat.

## 5. Eén gezondheidsoordeel

`shared/modelHealth.js` vat de metingen samen in `ok` / `degraded` / `blocked`
met uitlegbare checks: opslag gevuld, integriteit, odds-versheid, kalibratie,
marktbenchmark en het sterktemodel. Het is een signaal, geen poort: een tijdelijke
dip mag de voorspellingen niet stilzetten.

## 6. De worker leest dezelfde gepubliceerde opslag

`scripts/worker/match-store-history.js` leest bij de start van de worker het
gepubliceerde `match-store/manifest.json` uit R2, weigert objecten die niet bij
het manifest passen, en zet de compacte records om in dezelfde vorm-index als
de lokale dagbronnen. Per voorspelling worden die afgeronde duels na de
providerbronnen in `homeRecent`/`awayRecent` gemerged, met de bron
`match-store-r2`. Zo geldt voor de voorspelling precies dezelfde historie als
voor clubanalyse en modelrapport, en is die herleidbaar in de
`formQualityWarnings` en `homeFormSource`-velden.

Faalt R2 (niet geconfigureerd, manifest ontbreekt, object onleesbaar), dan
rapporteert de worker de reden in `store.matchStoreRemote` en draait door op de
bestaande bronnen: de koppeling kan de voorspellingen nooit stilzetten. De
clubindex blijft een `Map` buiten `server_data.json`; alleen de samenvatting
(matches, clubs, publicatietijdstip, reden) wordt bewaard.

Afgedekt door `tests/unit/match-store-history.test.js`: conversie, weigering van
onmogelijke records, canonical clublookup, manifest-mismatch, ontbrekend
manifest, niet-geconfigureerde R2 en een falende reader.

## Wat er nog openstaat

1. Modelprobabiliteiten per wedstrijd bewaren, zodat de fit op de volledige
   verdeling kan in plaats van alleen op de gekozen uitkomst.
2. De rho-sweep heeft pas betekenis vanaf ongeveer 250 walk-forward-duels.
3. De worker gebruikt de opslag nu voor vorm; de volgende stap is onderlinge
   duels (h2h) en rustdagen uit dezelfde bron laten komen.
