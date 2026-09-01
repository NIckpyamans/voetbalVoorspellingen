# FootyAI verbeteraudit

Periode: 2026-08-26 t/m 2026-09-01

AI bundel over de laatste 7 dagen: 2 monitorthema's en 5 uitvoerbare verbeteracties.

- Runs: 7
- Bevindingen: 4
- Thema's: 2

## Hoofdpunten
- Workerdata verouderd (3x, severity: high)
  - Gebruik het reviewbranch-voorstel als veilige volgende patchronde.
- H2H niet gevuld (1x, severity: medium)
  - Trek H2H verder uit historische competitiebestanden en bewaak fallbackdekking in de worker.

## Architectuuranalyse
Professionele architectuuranalyse voor schaalbaarheid, datakwaliteit, AI-agentwaarde, databasegroei en modelbetrouwbaarheid.

- Worker-core blijft te groot (Hoog, impact: Zeer hoog)
  - Probleem: Data collection, validatie, prediction, archivering en datumlogica zijn deels opgesplitst, maar scripts/server-worker.js blijft de grote orkestratielaag.
  - Oorzaak: De eerste veilige module-extracties zijn uitgevoerd; veel domeinlogica is nog gekoppeld aan de centrale store.
  - Risico: Nieuwe competities, databronnen en modellen worden moeilijk testbaar en vergroten regressierisico.
  - Oplossing: Ga verder met kleine domeinextracties en voeg per module contracttests toe.
- R2/Neon-opslaglagen moeten aantoonbaar synchroon blijven (Hoog, impact: Zeer hoog)
  - Probleem: R2 houdt snapshots en captures beschikbaar wanneer Neon quota blokkeert, maar relationele replay kan daardoor achterlopen.
  - Oorzaak: Neon is de relationele kern en R2 is archief/fallback; beide lagen hebben een herstelcontract nodig.
  - Risico: Dashboard en evaluatie blijven werken, terwijl relationele dekking ongemerkt veroudert.
  - Oplossing: Test R2 dagelijks, meet Neon-beschikbaarheid en replay critical captures automatisch zodra Neon herstelt.
- Providerdekking blijft de modelkwaliteit begrenzen (Hoog, impact: Zeer hoog)
  - Probleem: H2H, confirmed lineups en timestamped odds zijn niet voor iedere gevolgde competitie beschikbaar.
  - Oorzaak: Gratis providers hebben verschillende competitie-, tijdvenster- en quotabeperkingen.
  - Risico: Voorspellingen krijgen een te vergelijkbare confidence terwijl de onderliggende bronkwaliteit verschilt.
  - Oplossing: Meet dekking per veld en competitie, bewaar missing reasons en stuur alleen gerichte fallbackjobs aan.
- Auditbewijs moet na iedere hersteljob worden vastgelegd (Hoog, impact: Hoog)
  - Probleem: Een workflow kan groen zijn terwijl het bijbehorende monitorrapport in Git verouderd blijft.
  - Oorzaak: Sommige specialistische workflows uploaden alleen tijdelijke artifacts.
  - Risico: Een latere analyse baseert prioriteiten op oude coverage- of quotacijfers.
  - Oplossing: Commit compacte, niet-gevoelige monitorrapporten met retries na iedere auditgestuurde hersteljob.
- Modelkalibratie is zwak (Hoog, impact: Hoog)
  - Probleem: League- en phase-profielen hebben verschillende aantallen unieke reviews en niet ieder segment verbetert de Brier-score.
  - Oorzaak: Reguliere competities, kwalificaties en friendlies hebben aantoonbaar verschillende foutprofielen.
  - Risico: Dashboard kan te zeker ogen terwijl real-world hitrates achterblijven.
  - Oplossing: Kalibreer in shadow mode per league/phase en promoveer alleen bij voldoende unieke wedstrijden en meetbare Brier-verbetering.

## Datakwaliteit
- Pending result backfills: 2
- Ontbrekende oude scores: 0
- H2H-dekking: 40%
- Vul eerst betrouwbare eindstanden aan voordat learning en ROI/CLV zwaarder worden gewogen.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.
- Afgeronde wedstrijden zijn aan post-matchreviews gekoppeld.
- Vul post-match statistieken en doelminuten via FotMob, APIfootball.com of GOAL shadow aan; nulvelden tellen niet als echte statistiek.
- Toon geen inzetadvies zolang bevestigde opstellingen, verse getimestampte 1X2-odds en minimaal 70% modeldata niet samen aanwezig zijn.

## Widgetintegraties
- Status: degraded
- Neon: niet verbonden
- Checks: 7/10 geslaagd
- Vul gratis pre-match odds snapshots voordat ROI/CLV wordt beoordeeld.
- Herstel de mislukte widgetcontracten: Neon database, Provider- en integriteitswidget, Prediction-snapshot-widget.

## Snapshot-evaluatie
- Status: completed (evaluated)
- Neon: fallback actief
- R2: 8118 gelezen, 3406 geëvalueerd
- Lokale fallback: 708 gelezen, 0 geëvalueerd
- Werkelijk geëvalueerd: 3406

## Snapshotgroei
- Snapshotrecords: 308
- Unieke snapshotwedstrijden: 302/150
- Resterend: 0
- Samengevoegde snapshotbron: 5767 club-snapshots

## Standaard uitgevoerde acties
- Database migratieplan bijwerken: docs/database-migration-plan.md (auto-maintained)
- Worker modularisatieplan bijwerken: docs/worker-modularization-plan.md (auto-maintained)
- Nieuwe dataverzameling/agents alleen na architectuurcriteria: docs/agent-data-collection-policy.md (guardrail-active)
- Herbruikbare data context bewaken: docs/data-context/analysis-context.json (context-active)

## Volgende aanbevelingen
1. H2H-dekking gericht verhogen (Hoog, impact: Hoog) - Actuele H2H-dekking is 40%; doel is minimaal 85% met betrouwbare historie en expliciete missing reasons.
2. Confirmed lineups rond kickoff verzamelen (Hoog, impact: Zeer hoog) - Confirmed-lineupdekking is 30%; T-75, T-45 en T-20 blijven de actieve capturevensters.
3. Opening-, prematch- en closing odds vastleggen (Hoog, impact: Zeer hoog) - Echte oddsdekking is 7%; CLV/ROI blijft geblokkeerd zonder geldige timestamped paren. API-Football accepteert het huidige plan nog niet.
4. R2/Neon-herstelketen controleren (Hoog, impact: Hoog) - Neon is geconfigureerd maar blokkeert met HTTP 402/quota; R2 blijft actief en replay moet automatisch hervatten na herstel.
5. League/phase-kalibratie in shadow mode beoordelen (Middel, impact: Hoog) - 71 unieke reguliere wedstrijden; gate gehaald. Promoveer alleen profielen met voldoende Brier-verbetering.

## Automatisch gestarte acties
1. H2H-dekking gericht verhogen: h2h-enrichment.yml
2. Confirmed lineups rond kickoff verzamelen: pre-kickoff-lineups.yml
3. Opening-, prematch- en closing odds vastleggen: free-prematch-odds.yml
4. R2/Neon-herstelketen controleren: storage-recovery.yml
5. League/phase-kalibratie in shadow mode beoordelen: nightly-model-maintenance.yml

## Reviewbranch voorstel
- Geen voorstel nodig.

## Mailstatus
- Mailverzending vereist nog aparte mailcredentials of een mailservice. De bundel wordt nu wel automatisch opgebouwd en opgeslagen.
