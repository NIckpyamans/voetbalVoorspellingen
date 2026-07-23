# Technical audit Voetbal-AI

Datum: 2026-07-23
Scope: branch `codex/step3b-layout`
Status: analyse en verbeterplan; geen productlogica gewijzigd

## 1. Managementsamenvatting

De applicatie is technisch veel verder dan een prototype. De basis bevat een React/Vite-dashboard, Vercel Functions, een centrale voetbalworker, bronlineage, leakage-veilige snapshots, Neon, Cloudflare R2, GitHub Actions, contracttests en modelmonitoring. De build is gezond: 33 unit/contracttests, TypeScript, 7 regressieasserties en de productiebuild slagen.

De grootste beperking is niet meer een ontbrekende functie, maar de combinatie van te weinig onafhankelijke evaluatiedata en te veel operationele complexiteit. De huidige 76 snapshot-backed rijen vertegenwoordigen slechts 5 unieke afgeronde wedstrijden. Daardoor kunnen handmatig gekozen modelgewichten nog niet betrouwbaar worden gepromoveerd. Tegelijk gaf het laatste formele rapport Neon HTTP 402, was H2H-dekking 25,6%, was oddsdekking voor de onderzochte UEFA-wedstrijden 21,1% en bevat de repository 33 workflows plus een worker van 11.323 regels.

De juiste eerstvolgende beweging is daarom:

1. Maak de immutable snapshot/evaluatieketen aantoonbaar onafhankelijk van Neon en bewaak unieke wedstrijden in plaats van rijen.
2. Centraliseer workflowplanning, bronquota en writes in een deterministische orchestrator.
3. Verhoog wedstrijddatadekking gericht: vorm, confirmed lineups, odds, H2H en provider-ID's.
4. Modulariseer de worker per domein en voeg contracttests toe voordat modelgewichten worden aangepast.
5. Vereenvoudig het dashboard verder rond top-5, dagwedstrijden en detail-on-demand.

## 2. Huidige architectuur

### Frontend

- React 19 + Vite 8 + TypeScript.
- `App.tsx` is de centrale UI-orchestrator (1.077 regels).
- Zware views en `MatchCard` worden lazy geladen.
- Dashboarddata komt via `velocityEngine`, `/api/matches`, `/api/predict`, `/api/history` en `/api/standings`.
- Wedstrijddetails worden per tab en pas na een klik opgehaald.
- Vercel Analytics, Speed Insights en Cloudflare Web Analytics zijn geintegreerd.

### API-laag

- Vercel Functions in `api/`.
- Read routes zijn publiek; write routes gebruiken origincontrole, rolgebonden tokens en een eenvoudige rate limiter.
- Datasourcevolgorde is database-first, daarna in-memory cache en GitHub/raw JSON fallback.
- R2 levert compacte dagcache en immutable critical captures.

### Data en opslag

- Neon/Postgres: relationele kern, resultaten, snapshots, odds, H2H, lineage en evaluaties.
- Cloudflare R2: dashboardcache, archief, immutable snapshotledger en critical captures.
- Git/JSON: compatibiliteits-, herstel- en exportlaag. `server_data.json` is lokaal nog 25,7 MB maar wordt niet gevolgd; dagelijkse JSON-bestanden en trainingexports worden wel gevolgd.
- Git-history is circa 235,6 MB packed; de actuele grootste tracked bestanden zijn een dagbestand van 4,45 MB en training snapshot van 4,3 MB.

### Worker en automatisering

- `scripts/server-worker.js` is 11.323 regels en nog steeds de centrale orchestrator plus veel domeinlogica.
- Extracties bestaan voor prediction, validation, data collection, archive, learning, training, identity en critical captures.
- Er zijn 33 GitHub-workflows. De centrale orchestrator draait ieder half uur, terwijl meerdere enrichment-jobs daarnaast eigen schedules hebben.
- Van de laatste 100 runs waren 95 succesvol, 3 door concurrency geannuleerd en 2 nog zonder eindstatus. Er waren geen recente failures in deze steekproef.

### Datastroom

`providers/open data -> discovery/enrichment jobs -> canonical match/team identity -> worker feature snapshot -> prediction -> Neon/R2/JSON -> Vercel APIs -> dashboard -> immutable evaluation -> calibration reports`

## 3. Bevindingen per prioriteit

### Prioriteit 1 - direct

#### P1.1 Evaluatie heeft te weinig onafhankelijke voorbeelden

- Probleem: 76 snapshot-backed rijen zijn afkomstig van slechts 5 unieke afgeronde wedstrijden; het evaluatierapport zag 7 unieke snapshotmatches.
- Waarom: meerdere snapshots van dezelfde wedstrijd zijn nuttig voor tijdsfasen, maar geen onafhankelijke labels.
- Bestanden: `scripts/prepare-ensemble-data.js`, `scripts/evaluate-prediction-snapshots.js`, `training/training-snapshot.json`, `monitor/snapshot-growth-monitor.json`.
- Oplossing: promotion gates op minimaal 50 unieke wedstrijden voor eerste calibratie, 150 voor beperkte leaguecalibratie en 500+ voor stabiele segmentvergelijking. Rapporteer altijd rijen en unieke fixtures apart.
- Risico nu: overfitting en schijnprecisie bij exacte score, confidence en leagueprofielen.
- Verwachte winst: zeer hoog; betrouwbare modelselectie in plaats van optimaliseren op duplicaten.

#### P1.2 Neon-quota onderbreekt relationele actualiteit

- Probleem: formele audits tonen HTTP 402 door overschreden data-transferquota; Sportmonks sync werd daardoor bewust overgeslagen.
- Waarom: grote queryresultaten, veel losse jobs en dubbele opslag-/fallbackpaden veroorzaken transfer en reads.
- Bestanden: `shared/database.js`, `api/_dataSource.ts`, `scripts/manage-neon-storage.js`, storage/archive scripts en data-integrity workflow.
- Oplossing: Neon uitsluitend voor relationele hot data; R2 voor payloads, exports, ledgers en dagcache. Voeg query budgets, geselecteerde kolommen, keyset pagination, read metrics per job en een harde 75/85/95%-quota policy toe.
- Risico nu: stale widgets, gemiste writes en uiteenlopende waarheid tussen Neon, R2 en Git.
- Verwachte winst: zeer hoog voor beschikbaarheid, kosten en snelheid.

#### P1.3 R2-fallback moet als productiecontract worden bewezen

- Probleem: de code ondersteunt R2-evaluatie, maar het laatste rapport meldde `configured: false`; lokale fallback hield evaluatie overeind.
- Waarom: configuratie en rapportmoment liepen niet aantoonbaar gelijk.
- Bestanden: `.github/workflows/prediction-evaluation.yml`, `shared/predictionSnapshotLedger.js`, `scripts/evaluate-prediction-snapshots.js`.
- Oplossing: dagelijkse synthetic canary die een snapshot naar R2 schrijft, terugleest, evalueert en checksum vergelijkt. Workflow faalt als Neon onbeschikbaar is en R2 niet aantoonbaar werkt.
- Risico nu: groen workflowresultaat kan op lokale repositorydata leunen in plaats van de productieledger.
- Verwachte winst: zeer hoog voor herstelbaarheid en auditbaarheid.

#### P1.4 Brondata is onvoldoende voor professionele confidence

- Probleem: laatste formele metingen: H2H 25,6%; UEFA odds 21,1%; squad enrichment 3 van 12 gecontroleerde teams; confirmed lineups blijven tijdsafhankelijk.
- Waarom: gratis bronnen hebben beperkte competitie-/endpointdekking en provider-ID mapping is onvolledig.
- Bestanden: `scripts/backfill-upcoming-h2h.js`, `scripts/collect-free-prematch-odds.js`, `scripts/collect-pre-kickoff-lineups.js`, `scripts/collect-upcoming-team-squads.js`, `scripts/worker/team-identity.js`.
- Oplossing: SLO per competitie en veld, niet een globaal percentage. Gebruik API-Football/Sportmonks alleen voor bewezen gaten; cache mappings; stop na quota floor; sla `sourceTimestamp`, `fetchedAt`, provider-ID en confidence op.
- Risico nu: lage datacompleteness wordt wel begrensd, maar top-5 kan alsnog overtuigender ogen dan de empirische basis rechtvaardigt.
- Verwachte winst: zeer hoog voor 1X2 en scoreverdeling.

#### P1.5 Workflowlandschap is te versnipperd

- Probleem: 33 workflows, met eigen schedules naast een halfuurlijkse orchestrator.
- Waarom: iedere nieuwe bron of reparatie kreeg een eigen scheduler.
- Bestanden: `.github/workflows/*.yml`, `scripts/workflow-orchestrator.js`.
- Oplossing: een scheduled orchestrator die reusable workflows/jobs aanroept op basis van fixturevenster, kickoffafstand, freshness, quota en hashwijziging. Alleen CodeQL, PR-quality en handmatige onderhoudstaken blijven zelfstandig.
- Risico nu: dubbele API-calls, Git-pushconflicten, concurrency-cancels en onduidelijke ownership.
- Verwachte winst: zeer hoog voor snelheid, quota en beheer.

### Prioriteit 2 - korte termijn

#### P2.1 Worker blijft een monoliet

- Probleem: 503 KB en 11.323 regels met prediction, bronmerge, rapportage en orchestration.
- Oplossing: extracteer achtereenvolgens fixture discovery, H2H merge, form/stats, lineup/availability, odds, report builders en persistence. Maak per module pure input/output-contracttests.
- Risico: regressies en moeilijk parallel onderhoud.
- Winst: zeer hoog voor testbaarheid en doorlooptijd.

#### P2.2 Modelgewichten zijn grotendeels handmatig

- Probleem: xG wordt via veel begrensde multiplicatieve correcties aangepast; Poisson wordt 78/22 met heuristiek geblend en confidence is deels formulegedreven.
- Bestanden: `scripts/server-worker.js` rond `predict`, `scripts/worker/prediction.js`.
- Oplossing: bevries huidige modelversie als baseline. Train pas na genoeg unieke snapshots een eenvoudige multinomiale/logistische 1X2-calibrator en goal-rate regressie. Gebruik rolling-origin backtests en promote alleen bij Brier/log-loss verbetering zonder calibration regression.
- Risico: complexe handregels kunnen elkaar maskeren en per competitie verkeerd uitpakken.
- Winst: hoog, maar pas na P1-datavolwassenheid.

#### P2.3 Leaguegemiddelde is hardcoded

- Probleem: `avgLeagueGoals = 1.35` is universeel, terwijl competities en fases verschillen.
- Oplossing: leakage-veilige, shrinkage-gekalibreerde home/away goal priors per competitie/seizoen/fase met globale fallback.
- Risico: systematische goal bias en onjuiste exacte scores.
- Winst: hoog voor scorematrix en totals.

#### P2.4 UI- en worker-normalisatie is nog dubbel

- Probleem: dashboard bevat eigen canonicalisatie/dedupe; API en worker normaliseren eveneens.
- Bestanden: `App.tsx`, `api/Matches.ts`, `shared/matchNormalization.js`, worker validation.
- Oplossing: een shared canonical match DTO en normalisatiecontract. Client alleen presenteren/filteren.
- Risico: verschillende fixture-identiteiten en scoreweergave per laag.
- Winst: hoog voor consistentie.

#### P2.5 Encodingfouten zijn zichtbaar

- Probleem: UI/data bevat mojibake zoals `Â·`, `DÃ¼sseldorf` en kapotte pictogramtekens.
- Bestanden: onder meer `App.tsx`, `components/CompactMatchRow.tsx`, gegenereerde JSON/rapporten.
- Oplossing: UTF-8 end-to-end, decode eenmaal bij bronadapter, reject/repair mojibake in validation en voeg snapshottest met Europese clubnamen toe.
- Risico: onprofessionele UI en mislukte teammatching.
- Winst: hoog voor UX en identity mapping.

#### P2.6 Publieke read-API mist gedeelde bescherming

- Probleem: writes zijn redelijk beschermd, maar read-routes hebben geen uniforme rate limiting, response budget of cachebeleid; in-memory write-rate limiting is per serverless instance.
- Bestanden: `shared/writeSecurity.ts`, `api/*.ts`.
- Oplossing: centrale request middleware, schema-validatie, maximale querylimieten, edge/cache headers en duurzame rate limiting voor kostbare routes. Tokens niet via prompts voor normale gebruikersflows.
- Risico: abuse, onverwachte Neon/R2-transfer en inconsistent gedrag per instance.
- Winst: hoog voor beveiliging en kosten.

### Prioriteit 3 - middellange termijn

#### P3.1 JSON/Git blijft te groot als runtimefallback

- Probleem: tracked dagdata en trainingartefacten groeien; Git-history is 235,6 MB.
- Oplossing: compacte manifesten in Git, immutable data in R2, relationele index in Neon. Retentie op dagbestanden en geen gegenereerde payloads in normale codecommits.
- Winst: middel/hoog voor checkout, Actions en deployments.

#### P3.2 Testdekking is selectief

- Probleem: 33 tests zijn goed gericht, maar API-fallbackmatrix, workflowbeslissingen, databasecontracten, accessibility en model golden sets zijn dun.
- Oplossing: provider fixtures met recorded payloads, API contracttests, orchestrator decision tests, axe-playwright, model invariants en rolling-backtest smoke test in CI.
- Winst: hoog voor betrouwbaarheid.

#### P3.3 `App.tsx` en `MatchCard.tsx` zijn te groot

- Probleem: 1.077 en circa 1.700 regels; veel lokale presentatie- en datalogica.
- Oplossing: `DashboardPage`, `useDashboardData`, `LeagueTabs`, `DailyMatches`, `MatchDetails` en afzonderlijke detailtabs. Gebruik een query/cachelaag met request cancellation.
- Winst: middel/hoog voor onderhoud en rendergedrag.

#### P3.4 Documentatie is verouderd

- Probleem: README beschrijft SofaScore als hoofdbron en browser-learning als kern, terwijl de huidige architectuur Neon/R2/GitHub-worker gebruikt.
- Oplossing: architecture decision records, actuele runbook, data ownership matrix en incidentprocedures.
- Winst: middel voor overdraagbaarheid.

#### P3.5 Bronnenbeleid en licenties vereisen expliciete governance

- Probleem: onofficiele/public endpoints van SofaScore, ESPN, BBC, Sky, Forza en Wikipedia kunnen veranderen of gebruiksbeperkingen hebben.
- Oplossing: per bron eigenaar, ToS/licentie, attribuutplicht, rate limit, toegestane velden, cacheduur, kill switch en fallback vastleggen. Geen HTML-scraping als primaire productieketen.
- Winst: hoog voor continuiteit en juridisch risico.

### Prioriteit 4 - optioneel/later

- Eigen read-only sports API met scoped API-keys, pas nadat intern datacontract stabiel is.
- R2 Data Catalog/Iceberg voor offline analytics bij veel grotere datasets.
- Explainability-samenvattingen met een LLM, uitsluitend uit gestructureerde features; nooit kansen of ontbrekende data laten verzinnen.
- Feature store of apart model-serving component pas na honderden/duizenden unieke evaluaties.
- Eigen domein + Cloudflare cache rules als verkeer de Vercel-cache werkelijk rechtvaardigt.

## 4. Modelaudit

### Sterk

- Dixon-Coles-correctie op Poisson voor lage scores.
- Begrensde correcties voorkomen extreme xG-verschuivingen.
- Modelagreement, datacompleteness, bronbetrouwbaarheid en friendly caps verlagen confidence.
- H2H wordt gewogen op sample, recentheid, competitiecontext en bronstatus.
- Pre-kickoff snapshots, cutoffcontrole, Brier score, log-loss en immutable evaluatie bestaan.
- Herhaalde snapshots van dezelfde match delen samen maximaal een trainingsgewicht.
- CLV blijft geblokkeerd zonder later getimestampte closing odds.

### Zwak/risicovol

- Universele goal prior en veel handmatige multiplicatieve regels.
- `confidence` is geen zuivere empirische kans; het is een samengestelde modelzekerheid. UI moet dit expliciet labelen.
- Exact-score kans en vertrouwen worden naast elkaar getoond en kunnen door gebruikers worden verward.
- Monte Carlo voegt bij dezelfde Poisson-aannames vooral numerieke bevestiging toe, geen onafhankelijk modelbewijs.
- Team learning en calibratie hebben nog te weinig unieke labels.
- Missing data gebruikt soms neutrale defaults; dat is verdedigbaar, maar missingness moet zelf als feature en UI-signaal zichtbaar blijven.

### Verplichte evaluatiemethode

- Rolling-origin split op datum; nooit random split over snapshots.
- Groepeer alle snapshots van een fixture in dezelfde fold.
- Metrics: 1X2 Brier/log-loss/calibration slope/ECE, exact hit, MAE goals, ranked probability score, coverage per confidencebucket.
- Segmenten alleen tonen bij minimum sample; anders `insufficient sample`.
- Baselines: bookmaker implied probabilities indien timestamp-safe, league prior, simpele Elo-Poisson en huidige productieversie.
- Promotion: kandidaat moet op meerdere vensters beter zijn en geen kritieke competitie verslechteren.

## 5. Bronnenstrategie

| Bron | Beste rol | Niet als | Belangrijk risico |
|---|---|---|---|
| API-Football | fixtures, IDs, H2H, lineups, injuries, odds fallback | onbeperkte polling | dagelijkse/minuutquota en fixturedekking varieert |
| Sportmonks | mapped fixtures, lineups, spelers, stats, odds waar abonnement dekt | universele fallback | endpoints/componenten zijn plan- en entitygebonden |
| The Odds API | marktcontrole en getimestampte odds | fixturebron | beperkte qualifiers/friendlies |
| Football-Data.co.uk | historische uitslagen, stats, odds/closing proxies | live odds | periodieke updates, competitiedekking |
| OpenFootball | seizoenen, resultaten, aliases, H2H | actuele lineup/odds | actuele volledigheid varieert |
| TheSportsDB | metadata, badges, fallbackfixtures/squads | enige waarheid | free methods/30 rpm en dekking beperkt |
| ESPN/BBC/Sky | fixture-/scorevalidatie | juridisch stabiele kern-API | onofficiele endpoints/paginawijzigingen |
| StatsBomb Open Data | historische xG/events/lineups | live dekking | geselecteerde wedstrijden en attributie |
| Understat/FBref | historische xG/shots waar toegestaan | universele live bron | scraping-/ToS-fragiliteit |
| Open-Meteo | weerscontext | commercieel gratis zonder toets | free API is non-commercial en vereist CC-BY |
| R2 | payloads, cache, archief, ledgers | relationele joins | operations/retentie bewaken |
| Neon | hot relationele kern en evaluatie | raw payloadwarehouse | 5 GB transfer op free plan, grote reads vermijden |

Bronprioriteit per veld moet dynamisch uit field trust komen, maar alleen binnen vooraf toegestane bronnen. Conflicten nooit stil overschrijven: bewaar beide values, timestamps en resolverreden.

## 6. Security en privacy

### Positief

- Secrets staan via env/GitHub secrets; lokale env en tokens zijn gitignored.
- Write endpoints gebruiken timing-safe tokenvergelijking, rollen, origincontrole en rate limiting.
- CSP, frame denial, nosniff, referrer- en permissions-policy staan in Vercelconfig.
- Logger redigeert gevoelige sleutelnamen.
- CodeQL en volledige PR-quality workflow bestaan.

### Verbeteren

- Maak security headers ook testbaar in Playwright.
- Voeg schema-validatie en payloadlimieten toe aan alle API-routes.
- Gebruik duurzame rate limiting voor gevoelige serverless endpoints.
- Roteer providerkeys periodiek en detecteer secrets in commits met GitHub secret scanning/gitleaks.
- Scheid production, preview en development database/R2-prefixes.
- Minimaliseer IP/logretentie en documenteer analytics/privacy.
- `npm audit` kon lokaal niet worden afgerond door registry-netwerktoegang; maak dependency review/Dependabot een verplichte CI-gate.

## 7. UX en frontend

### Behouden

- Top-5 bovenaan, daarna compacte dagwedstrijden.
- Competitietabs als filterlaag, niet als aparte opslagarchitectuur.
- Details en tabs pas laden na klik.
- Lazy chunks: hoofdchunk circa 258 kB, MatchCard circa 60 kB, Settings circa 70 kB.

### Verbeteren

- Boven de vouw alleen datum, top-5 en daglijst; bronbeheer/modelops secundair.
- Label `confidence` als `modelvertrouwen`, naast `exacte-scorekans`, met tooltip dat het geen garantie is.
- Toon freshness en ontbrekende kernvelden compact per match.
- Voeg root ErrorBoundary en retry-state toe om wit scherm definitief af te vangen.
- Verminder glaslagen/achtergrondcontrast voor leesbaarheid en GPU-kosten.
- Accessibility: semantische headings/landmarks, zichtbare focus, toetsenbordtabs, labels voor inputs en axe-test. Er zijn momenteel slechts circa 24 expliciete aria/alt/focusmarkeringen in de grote UI.
- Los alle UTF-8/mojibake op.

## 8. AI en agents

### Wel nuttig

- Deterministische source-health agent die gaps, quota en stale data classificeert.
- Anomaliedetectie op odds, scores, teammapping en bronconflicten.
- LLM-uitleg uit een gesloten JSON-context met bronverwijzingen.
- Review-agent die alleen PR-voorstellen maakt en nooit autonoom modelgewichten promoot.

### Niet nuttig

- Een chatbot per competitie.
- LLM voor teamnaamnormalisatie, odds of voorspelde opstellingen als feitelijke bron.
- Autonome productiecodewijzigingen of providerkeuze zonder acceptance metrics.

Een centrale quota-aware planner is goedkoper, sneller en beter reproduceerbaar dan meerdere chatbots.

## 9. Gewenste doelarchitectuur

1. `scheduler`: een GitHub orchestrator met fixture-aware planning.
2. `adapters`: provider-specifieke clients met quota, retries, schemas en licenses.
3. `identity`: canonical competitions, fixtures, clubs, aliases en provider IDs.
4. `enrichment`: losse H2H, form/stats, lineup/availability en odds jobs.
5. `feature snapshot`: immutable, timestamped en leakage-safe.
6. `prediction service`: pure versioned modelinput naar modeloutput.
7. `evaluation`: R2/Neon onafhankelijke ledger, rolling metrics en promotion gate.
8. `storage`: Neon hot relational; R2 raw/cache/archive; Git alleen code/config/kleine manifests.
9. `API`: compacte list endpoints, sectioned details, caching en response budgets.
10. `frontend`: top-5 + daglijst + lazy detailtabs, ErrorBoundary en accessibility.

## 10. Gefaseerd uitvoeringsplan

### Fase A - bewijs en stabiliteit (1-2 weken)

- R2 canary voor snapshot write/read/evaluate.
- Quota dashboard per provider en Neon/R2.
- Orchestrator ownershipmatrix; dubbele schedules uitschakelen na shadow-run.
- UTF-8 validation en UI-repair.
- API response/schema/security tests.

Acceptatie: evaluator werkt zonder Neon; geen dubbele jobs; geen mojibake; alle bestaande tests groen.

### Fase B - datadekking (2-6 weken)

- Provider-ID mapping voor gevolgde clubs/UEFA-teams.
- Vorm 5+ matches, H2H reliability, standings en stats per fixture.
- Lineup polling T-75/T-45/T-20 alleen voor mapped fixtures.
- Odds opening/prematch/closing ledger met timestampvalidatie.

Acceptatie: per competitie meetbare SLO; geen verzonnen data; quota floor nooit overschreden.

### Fase C - modularisatie (3-8 weken, parallel in kleine PR's)

- Workerextracties met golden contracttests.
- App hooks/components splitsen.
- Git-data naar R2 manifests migreren.

Acceptatie: worker is primair orchestrator; geen contractwijziging zonder migratietest.

### Fase D - modelverbetering (na minimaal 50/150 unieke fixtures)

- League/phase priors met shrinkage.
- 1X2 probability calibrator en goal-rate kandidaatmodel.
- Rolling backtest en shadow deployment.
- Exact-score optimalisatie pas als 1X2 en goal distributions stabiel zijn.

Acceptatie: Brier/log-loss en calibration verbeteren tegenover baseline; geen segmentregressie boven afgesproken grens.

## 11. Testplan voor toekomstige wijzigingen

- Unit: pure normalisatie, featureberekening, confidence caps, quota planner.
- Contract: recorded providerpayloads, 401/403/404/429/5xx en schemawijzigingen.
- Database: migrations, idempotente upserts, canonical uniqueness, rollback.
- Integration: Neon actief, Neon 402, R2 actief, R2 fout, Git fallback.
- Model: no post-kickoff features, fixture-grouped folds, deterministic output, probability sum 1.
- E2E: desktop/mobiel, lege dag, drukke dag, providerstoring, detailtabs, wit-schermpreventie.
- Security: CSP/CORS, write roles, abuse limits, secret scanning.
- Performance: responsebudget per endpoint, bundlebudget en renderbudget voor 100/500 matches.

## 12. Besluit

Voer nog geen nieuwe modelgewichten of extra AI-bots in. De eerste implementatiefase moet P1.1 tot en met P1.5 oplossen. Daarna is de volgorde: datadekking, modularisatie, empirische calibratie en pas als laatste verdere exacte-scoreoptimalisatie.
