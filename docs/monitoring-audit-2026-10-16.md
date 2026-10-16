# Monitoring-audit en procesverbetering — 16 oktober 2026

## Opdracht, reikwijdte en methode

Audit van de bestaande repository NIckpyamans/voetbalVoorspellingen, productiebranch `codex/step3b-layout`, uitgangscommit `ef50a1650`. Eerst bestaande workflows, monitoringcode, rapporten, datastromen en recente GitHub-runlogs onderzocht; daarna gerichte aanpassingen. Geen nieuwe betaalde dienst, abonnement, modelweging of massale datamigratie toegevoegd.

Bewijs bestaat uit broncode, GitHub-uitvoeringen, gerichte foutsimulaties en productie-API-controles. Een groene workflow is geen bewijs dat alle data geschreven is: `ci-neon-safe.js` zet sommige quota-/netwerkfouten om in een succesvolle soft-skip. Deze beperking is nadrukkelijk onderdeel van de audit. Niet elke provider is opnieuw aangeroepen; quotabudgetten worden behouden. Ook geen volledige hertraining/backtest of live storingsinjectie uitgevoerd.

## 1. Bestaande architectuur en beoordeling

| Onderdeel | Oordeel vóór wijziging | Bevinding / besluit |
|---|---|---|
| GitHub-orchestrator | Aanscherpen | Bestaat, halfuurlijkse planning, quota- en fixturegestuurde dispatch. Dispatch bewijst geen afgerond herstel. Hergebruikt. |
| Hoofdworker en live-score | Aanscherpen | Verrijking, voorspellingen en publicatie bestaan; recente time-outs bevestigd. Bronaanvragen begrensd en ESPN beperkt parallel gemaakt. |
| Fixture-identiteit en deduplicatie | Goed ontwerp | Canonical merge, clubmapping, quarantaine en integriteitscontroles bestaan. Niet opnieuw gebouwd; geen bewijs dat alle historische ambiguïteiten weg zijn. |
| Post-match en historische context | Goed ontwerp | Bestaande behouds-/lekkagecontroles en tests; geen historische records gewist of nieuwe modelinput teruggeschreven. |
| Vorm, H2H, squads, lineups | Goed ontwerp / dekking aanscherpen | Gespecialiseerde jobs, aliases en ontbreekredenen bestaan. Beschikbaarheid blijft providerafhankelijk. Geen kunstmatige waarde voor ontbrekende spelers. |
| Clubrating en competitieverschillen | Goed ontwerp / validatie nodig | Bestaand bronbeleid voor waarde, Elo, competitie en spelers behouden. Geen beoordeling op reputatie alleen; uitkomsten vereisen backtesting. |
| WK 2026 / nationale teams | Aanscherpen | Nationaal/clubonderscheid en competitiescope bestaan. WK 2026 is inmiddels historisch; niet als toekomstige live competitie geforceerd. Squadactualiteit per peildatum blijft te controleren. |
| Providerquota en fallbacks | Aanscherpen | Audits, cache, circuit breakers en fallbackroutes bestaan; live-score had R2-secrets niet aangesloten. Gerepareerd. |
| Opslag / R2 / Neon | Aanscherpen | Canary, archivering, replay en storage-recovery bestaan. HTTP 402 en te grote ledger daadwerkelijk gezien; geen gratis capaciteitsgarantie op basis van alleen code. |
| Regressie / CI | Aanscherpen | 517 tests slaagden in onderzochte run, vier odds-mappingtests faalden. Ontbrekende export en twee competitiemappings hersteld. |
| Repositorybudget | Goed met waarschuwing | Lokale meting circa 97,7 MB, harde grens 148,9 MB. Oude melding van harde overschrijding is nu niet de CI-fout. Zachte grens 78,6 MB blijft overschreden. |
| Modelkwaliteit / kalibratie | Goed ontwerp / bewijs aanscherpen | Brier, logloss, tijdsvalidatie, minimumsteekproeven en shadowpromotie bestaan. Automatische audit behoudt shadowmodus; geen extra gewichtswijzigingen. |
| Drift / kwaliteitsdalingen | Aanscherpen | Bestaande drempels op trust, hitrate en Brier; geen algemene statistische driftgarantie. Steekproeven en cohortvergelijking blijven belangrijk. |
| Dagelijkse voorspellingsmonitor | Aanscherpen | Ontbrekende numerieke waarden konden nul worden, ontbrekende booleans een misser. Nu uitgesloten; lege dag is onbekend, niet automatisch een bewezen exportgat. |
| Wekelijkse analyse | Aanscherpen | Werkte vijfmaal per maand, gebruikte laatste opgeslagen bevindingsdag. Nu echte weekplanning en venster vanaf vandaag, bronactualiteit en uitvoeringshistorie erbij. |
| Neon-watchdog | Goed voor databaseprobe | Bestond al, apart van dataverwerkingswachtrij. Uitgebreid met onafhankelijke workflow-evidence-job zonder database/npm-afhankelijkheid. |
| Controle op monitoruitval | Ontbrak in deze keten | Nu ontbrekende successen, herhaalde fouten, oude rapporten en lang wachtende runs zichtbaar. GitHub-platformuitval blijft een gedeelde afhankelijkheid. |
| Dashboard | Aanscherpen | Providerbeheer bestaat; daar uitvoeringsstatus en controle-tijd toegevoegd. Geen tweede dashboard gebouwd. |
| Ruflo / vaste adviezen | Overbodige claims; functie behouden | Regelgebaseerde bundeling presenteerde zich als AI-onderzoek en kon ontbrekende lokale data als nul meten. Claims gecorrigeerd en ontbrekende invoer onbekend gemaakt. |
| Notificatiebezorging | Ontbreekt als bewezen end-to-end controle | Slackcode bestaat; geen bewijs van ontvangst. Deze audit stuurt geen externe berichten. GitHub-summary/artifacts en dashboard vormen de verifieerbare kanalen. |

De workflowinventaris onderaan bevat alle bestaande planningen. 'Goed ontwerp' betekent dat infrastructuur en controles aanwezig zijn, niet dat iedere uitvoering of elk bronrecord gezond is.

## 2. Vastgestelde problemen en runbewijs

- Hoofdworker [38851318873](https://github.com/NIckpyamans/voetbalVoorspellingen/actions/runs/38851318873): assemblage 04:46:38–04:55:51 UTC, beëindigd door negenminutenlimiet. Meerdere opeenvolgende fouten; laatste eerder aangetroffen succes 15 oktober 12:52 UTC.
- Live-score [38851314387](https://github.com/NIckpyamans/voetbalVoorspellingen/actions/runs/38851314387): achtminutentime-out, eerste dag pas na circa zes minuten verzameld. Log meldt R2 niet geconfigureerd; workflow bevatte die secrets niet.
- Evaluatie [38719100882](https://github.com/NIckpyamans/voetbalVoorspellingen/actions/runs/38719100882): Neon HTTP 402 én R2-maand augustus boven 100.663.296 bytes. Evaluatiefallback liep daardoor ook vast.
- Regressie [38729494904](https://github.com/NIckpyamans/voetbalVoorspellingen/actions/runs/38729494904): `inferOddsApiSportKeys is not a function`; vier falende mappingtests. Geen bewezen actuele repositorybudgetfout.
- Audit [38728254855](https://github.com/NIckpyamans/voetbalVoorspellingen/actions/runs/38728254855): succesvol 15 oktober. Ook 8 en 1 oktober geslaagd. Starttijden lagen uren na geconfigureerde cron; een planning is geen punctualiteitsgarantie.
- Productie `/api/health` tijdens nulmeting: `degraded`, workerdata circa 930 minuten oud tegenover norm 180 minuten. Een gezonde databaseprobe had dit niet verholpen.

## 3. Uitgevoerde verbeteringen

1. Bestaande Neon-watchdog uitgebreid met aparte, lichte controle van elf kritieke workflows. Leest maximaal drie pagina's per workflow, laatste zeven dagen; vermeldt afgekapt bewijs. Geen provider-, Neon- of R2-verbruik voor deze controle.
2. Herhaalde fouten, laatste mislukking, verouderd succes, ontbrekende runs, twee uur wachtende/lopende runs en uitvoeringsherstel worden expliciet vastgelegd. Herstel heet alleen uitvoeringsherstel zolang dataverificatie ontbreekt.
3. Compact dashboardbewijs bij statuswijziging of zesuursheartbeat; ieder checkresultaat als artifact met zeven dagen retentie. Dashboard verwerpt bewijs ouder dan acht uur en ongeldige toekomstige datums.
4. Weekaudit op maandag 06:19 UTC, timeout 25 minuten, artifacts ook bij fout. Laatste zeven kalenderdagen vanaf vandaag; ontbrekende observaties worden geen groen oordeel. Adviesplan wordt niet langer 'uitgevoerd' genoemd vóór dispatch. Handmatig rapport draaien zonder hersteljobs kan met `dispatch_actions=false`.
5. Bronactualiteit in weekrapport; bestaande data-/widget-/model-/lineuprapporten blijven hergebruikt. Geen nieuw los monitorplatform.
6. Dagelijkse monitor behandelt ontbrekende Brier, xG, rustdagen, Elo en hits als ontbrekend. Missers gesorteerd op Brier; peildatum aanwezig.
7. Odds-export en mappings voor 2. Bundesliga en Ligue 2 hersteld. Bestaande FA Cup-inactiviteitslogica behouden.
8. HTTP-timeout geldt ook tijdens lezen van antwoordbody; tekstaanvragen krijgen eveneens een grens. ESPN verzamelt met maximaal drie gelijktijdige league-verzoeken en hergebruikt overlappende vorige-dagvragen binnen één run. Bronvolgorde blijft deterministisch; geen extra requests.
9. Live-score krijgt de bestaande R2-configuratie. Evaluatie gebruikt dezelfde begrensde 512-MiB-ledgerleeslimiet als de dagelijkse monitor, alleen op de runner; serverlesslimiet niet verhoogd.
10. Ruflo maakt ontbrekende lokale brondata zichtbaar en noemt de feitelijke regelgebaseerde werkwijze.

## 4. Automatisering, herstel en veiligheid

De bestaande weekaudit blijft maximaal vijf bestaande hersteljobs voorstellen/starten; standaard shadowmodus en quota's blijven gelden. Dit is geen onbeperkte zelfwijzigende AI-agent. Een jobnaam in het plan is geen bewijs van succesvolle reparatie. Workflowhistorie toont recidive en eerdere fouten; echte verbetering moet vervolgens blijken uit verse dekkings-/modelrapporten.

Monitorjob staat niet in `football-data-refresh` en heeft geen `needs` op de databaseprobe. Hierdoor blijft hij draaien als Neon of de zware job vastloopt. Omdat beide op GitHub draaien, kan hij een totale GitHub-uitval niet vanuit een tweede cloud melden. Het dashboard detecteert dan wel verlopen bewijs zodra het wordt opgevraagd. Externe berichtbezorging is niet aangetoond; geen nieuwe betaalde notificatievoorziening toegevoegd.

Er is een bestaande bronnenworkflow voor GOAL, Transfermarkt, Wikidata, Betfair en open data, met dag/week/maandplanning. Deze is hergebruikt en niet verdubbeld. Dat is geen autonome webresearch naar alle nieuwe bronnen. Toevoeging van onbekende bronnen vereist licentie-, quota-, identiteit- en historische timestampcontrole; gratis toegankelijk is niet hetzelfde als gegarandeerde kwaliteit of hergebruikrecht.

## 5. Tests en vrijgave

Gerichte foutsimulaties: ontbrekend rapport, verouderd succes, toekomstige timestamp, drie opeenvolgende fouten, geblokkeerde wachtrij, annulering, herstel zonder dataverificatie, ontbrekende metrics, vastlopende HTTP-body en behoud van caller-cancellation. Bounded-concurrencytest bewaakt maximum en bronvolgorde; overlaptest bewaakt aantal ESPN-calls en niet cachen van fouten.

De initiële sandboxtest kon Windows-tempbestanden niet hernoemen (EPERM); dezelfde tests buiten die beperking uitgevoerd. Een bestaande contracttest eiste vijf maandruns; aangepast aan de expliciete nieuwe weekopdracht. TypeScript en productiebuild slagen bij eerste controle. Definitieve suite- en live-uitkomsten worden hieronder na publicatie toegevoegd.

## 6. Kosten en gratis limieten

Geen nieuwe betaalde afhankelijkheid of upgrade. Repository is publiek; standaard GitHub-hosted runners vallen onder de gratis publieke uitvoering. Nieuwe collector maximaal 33 API-requests per run, doorgaans minder. Compacte artifacts zeven dagen, gepubliceerde heartbeat zesuurlijks of bij wijziging. Gitgeschiedenis blijft daarom groeien, maar veel minder dan volledige dagelijkse datasets.

- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions): standaardrunners voor publieke repositories gratis; private/larger runners hebben andere voorwaarden.
- [GitHub schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows): start kan vertragen, publieke schedules kunnen na 60 dagen inactiviteit worden uitgezet. Geen realtime-SLA voor kickoffcaptures.
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/): standaard free tier 10 GB-maand, 1 miljoen Class A en 10 miljoen Class B operations. Accountgebruik en eventuele overage zijn niet via deze code-audit bewezen.
- [Neon actuele aankondiging](https://neon.com/blog/neon-free-plan-1-gb-per-project): nieuwe gratis opslaggrens 1 GB per project. Repository hanteert nog conservatief 512 MiB. Niet automatisch verhoogd: daadwerkelijke accountlimiet en oorzaak HTTP 402 moeten eerst worden vastgesteld; opslagruimte lost transferquota niet op.
- Vercel: bestaande deployment en API-route hergebruikt, geen extra cron of betaald plan. Dashboardcontrole voegt een kleine publieke GitHub-read per openen toe. Geen garantie dat totaal accountverbruik altijd onder gratis limieten blijft.

## 7. Resterende risico's en beperkingen

- HTTP 402 blijft een echte providerlimiet; code kan dit niet betrouwbaar 'actief maken'. Geen betaald abonnement aangezet.
- Worker-time-outs zijn feitelijk vastgesteld. Timeoutfix en beperkte parallelisatie moeten met een afgeronde nieuwe productierun worden beoordeeld; geen herstelclaim op basis van alleen tests.
- Soft-skips kunnen groene workflows geven zonder publicatie. Nieuwe monitoring vermeldt dit; een uniforme publicatiereceipt per taak ontbreekt nog.
- Huidige API-gezondheid gebruikt deels de nieuwste databasewijziging als versheidssignaal; dat is niet noodzakelijk de voorspelling van vandaag. Aparte datasetversheid blijft gewenst.
- De daily monitor kan meerdere snapshots per wedstrijd bevatten. Voor promotie blijven de bestaande unieke-fixturegates leidend; dagpercentages zijn geen zelfstandige promotiemaatstaf.
- Sommige free-source-batchjobs hebben geen expliciete timeout; GitHub-standaardlimiet is ruim. Die jobs niet zonder runtimeonderzoek ingekort.
- Geen integrale controle van externe notificatieontvangst, alle historische spelerswaarden of elke wedstrijdidentiteit. Dat staat niet gelijk aan 'in orde'.

## 8. Top vijf vervolgstappen

1. **Hoog: publicatiebewijs per taak.** Bewaar datasetpeildatum, aantal verwerkte fixtures, hash/versie en succesvolle R2/Neon-readback; rapporteer soft-skip afzonderlijk van succes.
2. **Hoog: verifieer worker- en evaluatieherstel.** Meet doorlooptijd per bron en verwerking; pas daarna eventueel batchgrootte aan. Voorkom opnieuw negen dagen overslaan na één trage bron.
3. **Hoog: sluit quota- en replaybewijs.** Bepaal actuele Neon accountlimiet/transfer, vergelijk R2-ledger met relationele evaluaties, herstel gericht zonder extra abonnement.
4. **Middel: valideer modellen per tijdscohort.** Vergelijk baseline, Brier, logloss, calibratie en foutmarges op unieke fixtures, per competitie en datadekking. Geen automatische gewichten op kleine steekproeven.
5. **Middel: bewijs notificatie en maatregel-effect.** Incident-ID koppelen aan dispatch, run, publicatie en voor/nameting; test ontvangst alleen via expliciet gekozen kanaal. Combineer dat met beperkte, licentiebewuste bronnenverkenning.

## Volledige workflowinventaris

Onderstaande inventaris is uit de huidige YAML gegenereerd. Geen schedule betekent handmatig, push of orchestrator; niet automatisch 'inactief'. Timeoutwaarden zijn per job, in minuten. Dit is een architectuurinventaris, geen verklaring dat alle jobs recent geslaagd zijn.

| Workflow | Cron (UTC) | Timeout |
|---|---|---|
| api-football-acceptance.yml | geen | 10 |
| api-football-coverage-scout.yml | geen | 15 |
| api-football-h2h-probe.yml | geen | 10 |
| biweekly-review-digest.yml | 19 6 * * 1 | 25 |
| codeql.yml | 31 2 * * 1 | 20 |
| competition-catalog-sync.yml | geen | 10 |
| coverage-repairs.yml | 11 */6 * * * | 30 |
| daily-prediction-monitor.yml | 30 6 * * * | 15 |
| dashboard-cache-r2.yml | geen | 12 |
| data-integrity-maintenance.yml | geen | 45 |
| database-schema.yml | geen | 10 |
| deploy-production.yml | geen | 20 |
| fixture-discovery.yml | geen | 10, 8, 12 |
| form-enrichment.yml | 37 */3 * * * | 5 |
| free-prematch-odds.yml | geen | 20 |
| free-source-batches.yml | geen | standaard, standaard, standaard, standaard, standaard, standaard, standaard |
| h2h-enrichment.yml | 17 */3 * * * | 20 |
| learn.yml | geen | 10 |
| live-score.yml | 10 * * * * | 15 |
| neon-health.yml | */30 * * * * | 7, 10 |
| new-free-data-sources.yml | 23 3 * * *; 41 2 * * 1; 17 1 1 * * | 10, 35, 35, 15 |
| nightly-model-maintenance.yml | geen | 25 |
| odds-snapshot-scout.yml | geen | 15 |
| orchestrator.yml | 15,45 * * * * | 10 |
| post-match-enrichment.yml | 37 2 * * * | 20 |
| pre-kickoff-lineups.yml | geen | 15 |
| prediction-evaluation.yml | 40 5 * * * | 20 |
| provider-quota-audit.yml | 17 4 * * * | 10 |
| pull-request-quality.yml | geen | 20 |
| regression-assertions.yml | 23 6 * * * | 10 |
| review-proposal.yml | 15 22 * * * | 15 |
| sportmonks-catalog-sync.yml | 41 3 * * 2 | 20 |
| sportmonks-fixture-mapping.yml | geen | 12 |
| statsbomb-full-backfill.yml | 41 1 * * 0 | 5, 180, 20 |
| storage-recovery.yml | 23 */6 * * * | 20 |
| sync-vercel-odds-secret.yml | geen | 10 |
| team-squad-enrichment.yml | 17 3,8,13,18 * * * | 12 |
| week-ahead-fixtures.yml | 23 5 * * * | 70 |
| worker.yml | geen | 15 |
