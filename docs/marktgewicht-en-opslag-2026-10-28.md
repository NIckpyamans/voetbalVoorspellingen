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

Dat is de eerste helft van "de worker leest dezelfde historie als de analyses".
De tweede helft — de worker die dit object daadwerkelijk als bron gebruikt —
staat nog open; die leest nu uit Neon en de losse R2-objecten.

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

## Wat er nog openstaat

1. De worker laten lezen uit het gepubliceerde `match-store/manifest.json`.
2. Modelprobabiliteiten per wedstrijd bewaren, zodat de fit op de volledige
   verdeling kan in plaats van alleen op de gekozen uitkomst.
3. De rho-sweep heeft pas betekenis vanaf ongeveer 250 walk-forward-duels.
