# Volledige technische audit - 17 juli 2026

## Scope en methode

Deze audit behandelt frontend, Vercel API's, Neon, Cloudflare R2, GitHub Actions, databronnen, de voorspellingspipeline, evaluatie, beveiliging en UX. De conclusies zijn gebaseerd op code-inspectie, TypeScript-checks, productiebuilds, regressietests, GitHub-runs en productie-API-controles. Percentages zijn alleen als kwaliteitssignaal gebruikt wanneer de onderliggende records onafhankelijk en tijdscorrect zijn.

## 1. Samenvatting huidige kwaliteit

De app is een bruikbaar data- en voorspellingsplatform met een goede club-only UI, een Dixon-Coles/Poisson-ensemble, bronlineage, leakage-controles, evaluatiemetrics en geautomatiseerde workflows. De grootste zwakte is niet de frontend maar de bewijsbasis: de productie-ledger groeide tijdens deze audit van 78 naar 114 snapshotrecords, maar de gecontroleerde trainingsset bevatte slechts 7 unieke wedstrijden en 5 unieke afgeronde wedstrijden met een label. Daardoor mag het model nog niet als professioneel gekalibreerd worden beschouwd.

De gemiddelde datacompleetheid van 36 toekomstige voorspellingen is na de laatste worker-run ongeveer 69,4%. Daarmee is het doel van gemiddeld 65% gehaald. De verdeling blijft ongelijk: 18 van 36 wedstrijden halen individueel 65%; kleinere UEFA-kwalificatiewedstrijden missen vaak H2H, vorm, xG, odds en bevestigde opstellingen.

Huidige beoordeling:

| Onderdeel | Status | Toelichting |
| --- | --- | --- |
| Frontend en dagoverzicht | Goed | Top-5, dagwedstrijden en detailtabs zijn aanwezig; code-splitting werkt. |
| API en caching | Redelijk tot goed | Compacte match/predict-responses en R2-cache; enkele endpoints zijn nog te groot. |
| Dataverzameling | Redelijk | Veel bronnen en fallbacks, maar wisselende dekking en enkele ongedocumenteerde bronnen. |
| Model | Experimenteel | Goede basis, maar te weinig unieke out-of-sample snapshots voor betrouwbare promotie. |
| Evaluatie | Technisch hersteld | Neon-onafhankelijk via R2/herstel-ledger; uniek-aantal wordt nu eerlijk gemeten. |
| Operations | Redelijk | Veel automatisering, maar 27 workflows en een worker van circa 12.000 regels verhogen onderhoudsrisico. |
| Beveiliging | Redelijk tot goed | Secrets server-side, CORS/CSP/CodeQL aanwezig; foutdetails en publieke API-limieten kunnen strakker. |

## 2. Wat al goed is

- React 19, TypeScript, Vite en lazy-loaded hoofdviews leveren een overzichtelijke frontend.
- De hoofd-bundle is circa 258 kB (80 kB gzip); zware schermen en MatchCard zijn aparte chunks.
- Neon bewaart relationele kerngegevens; R2 wordt gebruikt voor cache, archief, exports en nu ook het immutable snapshotledger.
- De modelcode gebruikt scorematrices, Poisson/Dixon-Coles, featurekwaliteit, ensemble-agreement en confidence-calibratie.
- Features voor vorm, thuis/uit, xG, Elo, rust, reisbelasting, blessures, schorsingen, opstellingen, weer, referee en odds zijn technisch aangesloten.
- Brontimestamps, source metadata en leakage guards zijn aanwezig.
- Evaluaties berekenen exact-hit, uitkomst-hit, Brier score en log loss. ROI en CLV blijven terecht geblokkeerd zonder geldige timestamps.
- GitHub Actions automatiseert worker, fixtures, odds, lineups, evaluatie, regressie, CodeQL, opslag en provider-audits.
- CSP, CORS, security headers, write-tokencontrole en dependency/CodeQL-controles zijn aanwezig.
- De twee publieke domeinen wijzen naar hetzelfde Vercel-project.

## 3. Kritieke fouten

### Opgelost in deze fase

1. **Evaluatie viel uit bij Neon HTTP 402.** De evaluator leest nu Neon, R2 en een lokale immutable recovery-ledger en rapporteert per bron hoeveel snapshots zijn gelezen en geëvalueerd.
2. **Een kleinere fallback kon trainingsdata vervangen.** Training merge is nu non-shrinking; bestaande geldige rijen blijven behouden.
3. **Groene evaluatie zonder werkelijke evaluaties.** De workflow faalt nu wanneer geen bruikbare snapshotbron bestaat of niets werkelijk kon worden geëvalueerd.
4. **Snapshotvolume werd overschat.** Groei en maturity gebruiken nu unieke `matchId`-aantallen. Herhaalde snapshots van één wedstrijd delen samen één trainingsgewicht.
5. **Vercel snapshot-API bleef Neon proberen.** De route gebruikt nu R2 en als laatste onafhankelijke laag een meegebundelde herstel-ledger.

### Nog kritiek voor modelpromotie

- Slechts 5 unieke afgeronde snapshotwedstrijden zijn evalueerbaar. Doel: minimaal 150 unieke afgeronde clubwedstrijden, verspreid over competities en uitkomsten.
- Er zijn nog geen betrouwbare prematch/closing-oddsparen. CLV en marktgebaseerde modelvergelijking kunnen daarom niet worden vrijgegeven.

## 4. Beveiligingsproblemen

| Risico | Niveau | Locatie | Aanpak |
| --- | --- | --- | --- |
| Interne provider-/databasefouten kunnen in API-responses terechtkomen | Gemiddeld | `api/prediction-snapshots.ts` en overige handlers | Publiek alleen foutcode/correlation-id tonen; volledige fout alleen server-side loggen. |
| Publieke lees-API's hebben geen centrale rate limiter | Gemiddeld | `api/*.ts` | Per IP/route een lichte limiet en cache toepassen; schrijf-API's streng houden. |
| Veel secrets worden naar drie Vercel-omgevingen gekopieerd | Gemiddeld | `.github/workflows/sync-vercel-odds-secret.yml` | Per runtime minimale secretset; dataworkers primair in GitHub Actions houden. |
| Ondergedocumenteerde externe endpoints kunnen blokkeren | Gemiddeld | worker-bronnen voor ESPN/Sofascore/OpenLigaDB | Circuit breaker, backoff, cache en vervangbare adapter verplicht houden. |
| Geen automatische lint/security-regels voor alle JS-scripts | Laag | `scripts/**`, `shared/**` | ESLint met security/no-floating-promises-regels toevoegen. |

Er zijn geen hardcoded productie-API-sleutels aangetroffen. `WRITE_API_TOKEN` en providerkeys blijven server-side.

## 5. Fouten en risico's in de datastroom

Gewenste volgorde en huidige status:

1. Ophalen: aanwezig via orchestrator en bronjobs.
2. Valideren: aanwezig, maar verspreid over adapters en worker.
3. Dedupliceren/normaliseren: canonical fixture merge en club aliases aanwezig.
4. Aanvullen: bronfallbacks aanwezig; dekking verschilt sterk per competitie.
5. Opslaan: Neon relationeel, R2 cache/archief, recovery-ledger voor snapshots.
6. Features: centraal in `scripts/worker/prediction.js`.
7. Voorspellen en immutable opslaan: aanwezig.
8. Publiceren: Vercel API en R2 dashboardcache.
9. Resultaten/evaluatie: aanwezig en nu Neon-onafhankelijk.
10. Kalibreren: aanwezig, maar moet geblokkeerd blijven tot voldoende unieke samples.

Belangrijkste risico's:

- `scripts/server-worker.js` bevat nog veel verzameling, normalisatie en orchestration in circa 12.000 regels.
- Bronnormalisatie bestaat zowel in worker, database helpers als enkele API/clienthelpers; contracttests moeten drift voorkomen.
- Neon-quota kan relationele writes blokkeren. De app blijft lezen via R2/recovery, maar nieuwe relationele feiten moeten later worden nagesynchroniseerd.
- R2 is object storage, geen vervanger voor relationele joins, constraints of transacties.

## 6. Voorspellingslogica

### Werkelijk aangesloten

- recente vorm en historische uitslagen;
- thuis/uit-splitsing;
- gescoorde/geïncasseerde goals en xG/shot-profielen waar beschikbaar;
- ClubElo, aanval/verdediging en tegenstandercontext;
- rustdagen, reisbelasting en thuisvoordeel;
- blessures, schorsingen, keeper- en lineupcontinuïteit;
- weersrisico en refereeprofiel;
- H2H met recency/reliability;
- wedstrijdgewicht/belang;
- bookmakerprofielen en echte snapshots wanneer aanwezig.

### Nog onvoldoende betrouwbaar gevuld

- bevestigde opstellingen: meestal pas in het laatste uur en bij friendlies vaak niet beschikbaar;
- echte prematch- en closing odds: dekking voor qualifiers en kleine competities is laag;
- refereeprofielen, xG en shots buiten topcompetities;
- trainerswissels, selectiediepte en spelerskwaliteit zijn grotendeels afgeleid en niet uniform timestamped;
- marktbeweging kan pas worden gebruikt zodra opening, prematch en closing apart zijn vastgelegd.

### Modelrisico's

- Exacte score is van nature een lage-kansdoelvariabele. Een percentage kunstmatig verhogen maakt de voorspelling niet beter.
- Confidence moet kalibratie betekenen, niet alleen dat veel velden gevuld zijn.
- De huidige unieke evaluatieset is te klein voor betrouwbare league/phase-kalibratie.
- Benchmarks moeten standaard worden opgeslagen: thuisfavoriet, league-baseline, pure Poisson en bookmaker-implied probabilities.
- Train/test-splits moeten tijdgebaseerd en per match gegroepeerd blijven; snapshots van dezelfde wedstrijd mogen nooit over train en test worden verdeeld.

## 7. Prestatieproblemen

- `/api/matches` en `/api/predict` zijn compacter gemaakt; detaildata wordt terecht pas per tab geladen.
- `/api/health` is nog circa 31 kB en moet standaard een compacte samenvatting geven met `detail=1` voor diagnose.
- MatchCard is circa 60 kB en Settings circa 70 kB; beide zijn al lazy chunks. Verdere optimalisatie is pas zinvol na meting van echte Core Web Vitals.
- Worker schrijft nog op meerdere plaatsen losse records. Batch-upserts en content-hash/no-change-controle geven de grootste databasewinst.
- 27 workflows veroorzaken overlap en extra cold starts. De orchestrator moet de enige planner worden; subworkflows alleen via dispatch/reuse.
- De Git-history blijft groot. Dit vertraagt clones maar niet de runtime; later gecoördineerd herschrijven.

## 8. Ontbrekende tests

Aanwezig: TypeScript, productiebuild, scriptgebaseerde regressie-, snapshot-, odds-, lineup- en archive-tests, CodeQL.

Nog toevoegen:

1. Vitest-unittests voor pure normalisatie, featurebouw, scorematrix, calibration en leakage guards.
2. Contracttests per provideradapter met opgeslagen, gesaneerde fixtures.
3. Database-integratietests tegen een aparte tijdelijke Neon/ lokale Postgres-testdatabase.
4. Playwright smoke-test voor homepage, datumwissel, Top-5, competitie-filter en detailtabs.
5. API-contracttests voor Neon 402, R2 404, provider 429/403 en beschadigde payloads.
6. Accessibility-test met axe in de Playwright-run.

## 9. Aanbevolen AI-functies

| Functie | Nu/later | Waarde | Kosten/risico |
| --- | --- | --- | --- |
| Uitleg van bestaande voorspelling op basis van gestructureerde features | Later | Begrijpelijkheid | Kleine LLM-kosten; mag geen nieuwe feiten verzinnen. |
| Automatische bronanomalie en schemadrift-detectie | Nu met regels, later AI | Hoge operationele waarde | Eerst JSON-schema/statistiek, AI alleen voor samenvatting. |
| Samenvatting van blessures/opstellingen | Later | UX | Alleen met gelicentieerde, timestamped brondata. |
| Model challenger-selectie | Later | Modelkwaliteit | Alleen na 150+ unieke snapshots; promotie via harde metrics. |
| Chatbot over wedstrijden | Later | Productfunctie | RAG op eigen API; bronvermelding en kostenlimiet vereist. |
| AI die zelfstandig code of productie wijzigt | Niet bouwen | Te groot risico | CodeQL/tests/review blijven menselijke gate. |

Voor data ophalen, dedupliceren, quota sturen en kalibratie zijn deterministische workflows betrouwbaarder en goedkoper dan chatbots.

## 10. Overbodige of te complexe onderdelen

- Losse schedules in 27 workflowbestanden; centraliseer de planning, behoud specialistische jobs als herbruikbare workflows.
- Een deel van rapportage/monitoring overlapt inhoudelijk. Maak één operationeel rapport met secties voor bronnen, model, opslag en frontend.
- Legacy asset-copy blijft alleen nodig zolang oude clients/bestandsnamen worden ondersteund; meet gebruik en verwijder later gecontroleerd.
- Grote handmatige/team-specifieke mappings in `server-worker.js` horen in versioned configuratie of canonieke tabellen.

## 11. Aanbevolen nieuwe functies

- Model card per actieve modelversie: trainingsperiode, unieke matches, competities, Brier/log loss, calibration en bekende beperkingen.
- Data freshness/status per wedstrijd en per detailtab.
- Benchmarkvergelijking in Model Ops.
- Quota-budget per provider met automatische dagverdeling op basis van kickoff-nabijheid en ontbrekende velden.
- Dead-letter/replay-lijst voor writes die tijdens Neon 402 niet konden worden opgeslagen.

## 12. Frontend en UX

De gewenste informatiehiërarchie is correct:

1. datum en eenvoudige competitie-filter;
2. Top-5 voorspelde exacte scores;
3. compacte wedstrijden van de dag;
4. details pas na klik: vorm, H2H, odds, opstelling en bronstatus.

Verbeteringen:

- Toon naast `kans` en `vertrouwen` een korte definitie: kans = modelkans op exacte score; vertrouwen = datakwaliteit + modelagreement na calibratie.
- Gebruik geen hoge confidence wanneer bevestigde opstelling of echte odds ontbreken.
- Toon `laatst bijgewerkt` en `gegevens ontbreken` direct op de rij.
- Zorg voor minimaal 44 px touch targets, zichtbare focus, semantische buttons en tabbedetail met ARIA.
- Virtualiseer alleen bij meer dan circa 80 zichtbare wedstrijden; eerder voegt dit onnodige complexiteit toe.
- Voeg fout- en offline-state toe die R2-cachetijd en retry toont, nooit een wit scherm.

## 13. Backend en database

- Neon behouden voor canonieke clubs, fixtures, relaties, snapshots/evaluaties en constraints.
- R2 behouden voor immutable ledger, raw payloads, exports, oude snapshots en dashboardcache.
- Introduceer een `pending_write_events` objectlog in R2 voor replay na Neon-quota-uitval.
- Maak alle writes idempotent met canonical id + content hash.
- Gebruik bulk-upserts per bronbatch en beperk full-table/VACUUM FULL-operaties.
- Definieer retentie: hot relationele features, warm evaluaties, cold raw payloads in R2.
- Voeg schema migrations met versie en rollbackcontrole toe in plaats van alleen imperatieve scripts.

## 14. GitHub Actions en Vercel

- GitHub Actions blijft de hoofdworker; Vercel bedient frontend en lichte API's.
- Orchestrator beslist op basis van fixtures, kickoffafstand, datagaten en providerquota welke jobs nodig zijn.
- Evaluatie-artifact en Step Summary tonen Neon/R2/recovery, gelezen snapshots, unieke matches en werkelijk geëvalueerd aantal.
- Production promotion moet gekoppeld worden aan geslaagde typecheck, build, regressie en snapshot-resiliencetest.
- Gebruik aparte previewdatabase of databasevrije R2 fixtures voor previews; geen previewwrites in productie.
- Voeg een dagelijkse endpoint-smoke-test toe voor beide publieke domeinen.

## 15. Aanbevolen mappenstructuur

Geen volledige rewrite; incrementeel naar:

```text
src/
  app/                 # React schermen en routing
  components/          # herbruikbare UI
  features/matches/    # daglijst, detailtabs, Top-5
api/
  routes/              # dunne handlers
  services/            # datasource, cache, response mapping
scripts/
  jobs/                # uitvoerbare jobs
  providers/           # één adapter per bron
  worker/              # orchestration, prediction, learning
shared/
  domain/              # canonical types en normalisatie
  storage/             # Neon/R2/recovery adapters
  contracts/           # schemas en broncontracten
tests/
  unit/
  contract/
  integration/
  e2e/
```

## 16. Prioriteitenlijst

| Prioriteit | Probleem | Bestanden/onderdelen | Aanbevolen oplossing | Wijzigingsrisico | Verwachte verbetering | Bereik |
| --- | --- | --- | --- | --- | --- | --- |
| 1 - uitgevoerd | Evaluatie afhankelijk van Neon-quota | `scripts/evaluate-prediction-snapshots.js`, `shared/predictionSnapshotLedger.js`, workflows | Immutable R2/recovery-ledger, bronrapport, hard fail bij nul evaluaties | Laag | Evaluatie blijft beschikbaar bij Neon 402 | evaluator, worker, API, training, Actions |
| 1 - uitgevoerd | Training kon krimpen en snapshots werden dubbel geteld | `scripts/worker/training-snapshot.js`, `scripts/prepare-ensemble-data.js`, monitors | Non-shrinking merge, unieke-matchgate, gedeeld gewicht | Gemiddeld | Eerlijke en stabiele trainingsbasis | training, readiness, rapportage |
| 1 - open | Te weinig onafhankelijke evaluaties | worker/evaluation schedules | Groei naar 150 unieke afgeronde clubmatches; geen synthetische duplicaten | Laag | Betrouwbare modelvergelijking en calibration | data, model, Model Ops |
| 2 - deels uitgevoerd | Datacompleetheid ongelijk | provider mappings, `scripts/server-worker.js`, providerjobs | Provider-ID's, vorm, standings, xG en timestamps per competitie aanvullen | Gemiddeld | Gemiddeld nu 69%; meer wedstrijden individueel boven 65% | providers, worker, database |
| 2 - open | Confirmed lineups laag | `collect-pre-kickoff-lineups.js`, workflow | Runs op T-75/T-45/T-20, fixture-ID mapping, bronstatus per team | Gemiddeld | Betere laatste-uur voorspellingen | providers, worker, UI |
| 2 - open | Geen closing oddsparen | odds collectors/scouts, R2 capture | Opening/prematch/closing als aparte immutable events koppelen | Hoog | Eerlijke CLV/ROI en marktbenchmark | providers, storage, model |
| 2 - open | H2H-dekking circa 25,6% | H2H backfill/provider adapters | Recency/competition-weighted H2H; missing blijft missing | Laag | Minder ruis en betere dekking | providers, features |
| 3 | Worker te groot | `scripts/server-worker.js` | Bronadapters, normalization en orchestration verder losmaken | Gemiddeld | Minder regressies, snellere tests | worker, scripts, tests |
| 3 | Workflows versnipperd | `.github/workflows/**` | Eén planner, herbruikbare subworkflows, concurrency-groepen | Gemiddeld | Minder overlap en quota/computeverbruik | Actions |
| 3 | Teststack onvolledig | hele repo | ESLint, Vitest contract/unit en Playwright smoke/axe | Laag | Snellere regressiedetectie | frontend, API, worker |
| 3 | API-diagnosepayload groot | `api/health.ts` | Compact default, uitgebreide diagnose achter `detail=1` en operatorauth | Laag | Snellere checks, minder transfer | API, monitoring |
| 4 | Model/experimenttracking beperkt | learning/calibration | Model cards en challenger registry na voldoende samples | Gemiddeld | Controleerbare modelpromotie | model, Model Ops |
| 4 | Eigen publieke sport-API | nieuwe gateway | Eerst interne read-only API met keys, scopes, quota en versiebeheer | Hoog | Hergebruik eigen data zonder kernpipeline te belasten | API, auth, docs |

## 17. Concreet uitvoeringsplan

### Fase A - afgerond

- Neon-onafhankelijk immutable snapshotledger.
- R2 en herstel-ledger als evaluator/API-fallback.
- Non-shrinking training.
- Unieke-matchweging en maturity gate.
- Rapportage van bronnen, gelezen en geëvalueerde snapshots.
- Provider-team-ID's en historische vorm uitgebreid.
- Datacompleetheid opnieuw en pre-match-correct berekend.

Acceptatie: typecheck, productiebuild, snapshot-resiliencetest, GitHub evaluation/worker/regression en productie-API smoke-test.

### Fase B - eerstvolgend

1. Verzamel 150 unieke afgeronde clubwedstrijden met immutable snapshots.
2. Voeg contracttests toe voor ESPN, TheSportsDB, API-Football, Sportmonks en oddsproviders.
3. Meet dekking per competitie en per veld; stuur quota naar de grootste gaten.
4. Laat lineups op T-75/T-45/T-20 draaien en bewaar de eerste confirmed timestamp.
5. Leg odds vast als opening, prematch en closing event, nooit als overschreven rij.

Acceptatie: minimaal 150 unieke labels, geen leakage-failures, minimaal 80% provider-ID-dekking in gevolgde topcompetities, lineupcoverage apart per competitie en geldige prematch/closing-paren.

### Fase C - daarna

1. Draai tijdgebaseerde benchmarkevaluatie per competitie.
2. Kalibreer outcome probabilities en confidence; exacte score blijft apart.
3. Promoveer alleen een challenger die Brier/log loss en calibration aantoonbaar verbetert zonder segmentregressie.
4. Modulariseer de worker en centraliseer workflows.
5. Voeg Vitest, providercontracttests en Playwright toe.

### Fase D - toekomstige uitbreiding

- Model cards en experiment registry.
- Uitleg-assistent op uitsluitend gestructureerde, geciteerde wedstrijdfacts.
- Eigen versioned read-only sport-API met scopes en rate limits.
- Eventueel betaalde provider alleen wanneer de ontbrekende competitievelden en licentievoorwaarden vooraf zijn vastgesteld.

## Databronadvies

| Bron | Beste rol | Beperking/risico | Beleid |
| --- | --- | --- | --- |
| API-Football | fixtures, teams, H2H, lineups, stats | Dagquota/plan en toekomstige fixtures | Primaire enrichment binnen quota; cache en budgettering. |
| Sportmonks | fixtures/odds/lineups waar plan toegang geeft | 403 bij niet-geabonneerde feature/league; entity rate limits | Alleen geautoriseerde leagues; plan niet via code oplosbaar. |
| The Odds API | brede odds waar sport/league beschikbaar is | Quota en beperkte kleine leagues | Oddsbackup en marktbenchmark, geen fixturebron. |
| football-data.co.uk | historische resultaten, shots en odds | CSV, vooral geselecteerde competities | Sterke historische bron; immutable import. |
| OpenFootball | fixtures en uitslagen | Community-updates, geen live/lineups | CC0-backup voor kalender/resultaten. |
| StatsBomb Open Data | historische events, lineups en xG | Selectie van competities; attributie vereist | Offline training/validatie, niet voor actuele dekking. |
| TheSportsDB | teams, metadata, schedules/resultaten | Crowd-sourced; free 30 requests/min en beperkte rijlimieten | Backup/identity, nooit enige uitslagbron. |
| ESPN endpoints | fixtures, friendlies en live scores | Geen stabiel publiek contract | Discovery met contractmonitor en tweede bevestigingsbron. |
| ClubElo | clubsterkte | Methodiek/dekking en gebruiksvoorwaarden bewaken | Dagcache; feature met freshnessscore. |
| Officiële club/competitiesites | bevestiging fixtures/opstellingen | HTML-wijzigingen, scraping/licentie | Alleen gerichte verificatie, laag requestvolume. |

Referenties: [API-Football pricing](https://www.api-football.com/pricing), [API-Football rate limits](https://www.api-football.com/news/post/how-ratelimit-works), [Sportmonks rate limits](https://docs.sportmonks.com/v3/api/rate-limit), [Sportmonks authenticatie](https://docs.sportmonks.com/v3/odds-api/getting-started/authentication), [football-data.org policies](https://docs.football-data.org/general/v4/policies.html), [TheSportsDB documentatie](https://www.thesportsdb.com/documentation), [TheSportsDB voorwaarden](https://www.thesportsdb.com/docs_terms_of_use.php), [OpenFootball CC0](https://github.com/openfootball/football.json) en [StatsBomb Open Data](https://github.com/statsbomb/open-data).
