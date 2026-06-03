# FootyAI tweewekelijkse AI-digest

Periode: 2026-05-21 t/m 2026-06-03

AI bundel over de laatste 14 dagen: 5 hoofdthema's uit 18 monitorbevindingen.

- Runs: 14
- Bevindingen: 18
- Thema's: 5

## Hoofdpunten
- Workerdata verouderd (10x, severity: high)
  - Gebruik het reviewbranch-voorstel als veilige volgende patchronde.
- Geen speeldagdata (4x, severity: medium)
  - Controleer brondekking en dagfilter in de worker voor vandaag + morgen.
- H2H niet gevuld (2x, severity: medium)
  - Trek H2H verder uit historische competitiebestanden en bewaak fallbackdekking in de worker.
- Fixturekalender onzeker (1x, severity: medium)
  - Controleer kalenderfallbacks; 0 wedstrijden is alleen ok als de worker dat kan verklaren.
- Bekerschema leeg (1x, severity: medium)
  - Gebruik het reviewbranch-voorstel als veilige volgende patchronde.

## Architectuuranalyse
Professionele architectuuranalyse voor schaalbaarheid, datakwaliteit, AI-agentwaarde, databasegroei en modelbetrouwbaarheid.

- Worker is monolithisch (Hoog, impact: Zeer hoog)
  - Probleem: De worker bevat data collection, validatie, prediction, learning, archivering en storage in een enkel bestand.
  - Oorzaak: Snelle iteratie heeft alle domeinen samengebracht in scripts/server-worker.js.
  - Risico: Nieuwe competities, databronnen en modellen worden moeilijk testbaar en vergroten regressierisico.
  - Oplossing: Splits de worker gefaseerd in domeinmodules met gelijkblijvende input/output-contracten.
- JSON is nog primaire datastore (Hoog, impact: Zeer hoog)
  - Probleem: server_data.json is groot en groeit lineair mee met wedstrijden, reviews en snapshots.
  - Oorzaak: GitHub JSON fungeert nu als bron van waarheid en distributielaag tegelijk.
  - Risico: Miljoenen wedstrijden zijn niet haalbaar met grote JSON-commits en serverless JSON-parsing.
  - Oplossing: Maak Postgres/Supabase primair en behoud JSON alleen als cache/exportlaag.
- Database-schema is nog prediction-ledger (Hoog, impact: Zeer hoog)
  - Probleem: Het schema mist genormaliseerde competities, clubs, seizoenen, teamstatistieken en source records.
  - Oorzaak: Het huidige schema is ontworpen rond predictions en evaluaties, niet rond een volledige football intelligence graph.
  - Risico: Seizoenbeheer, historische standen en bronherleidbaarheid worden later duur om te herstellen.
  - Oplossing: Breid het schema uit met competition, club, season, match stats, source lineage en archive-tabellen.
- Dubbele normalisatie/backfill (Hoog, impact: Hoog)
  - Probleem: Result-backfill en dedupe staan in worker, API en clientservice.
  - Oorzaak: Noodvangnetten zijn op meerdere lagen toegevoegd.
  - Risico: Verschillende lagen kunnen andere eindstanden of matchidentiteiten tonen.
  - Oplossing: Centraliseer normalisatie in een gedeelde module en laat API/client alleen consumeren.
- Modelkalibratie is zwak (Hoog, impact: Hoog)
  - Probleem: Live analyse meldt een kalibratiefout rond 0.206 en exact-score hitrate rond 12%.
  - Oorzaak: Exact-score selectie, confidence en 1X2-probabilities worden nog niet volledig op echte odds en closing lines gekalibreerd.
  - Risico: Dashboard kan te zeker ogen terwijl real-world hitrates achterblijven.
  - Oplossing: Kalibreer per league/phase/model en gebruik echte odds pas zodra odds_at_prediction betrouwbaar is.

## Datakwaliteit
- Pending result backfills: 0
- Ontbrekende oude scores: 0
- H2H-dekking: 86%
- Resultaatbackfill is schoon binnen de auditperiode.
- H2H-dekking is voldoende voor de huidige auditperiode.

## Standaard uitgevoerde acties
- Database migratieplan bijwerken: docs/database-migration-plan.md (auto-maintained)
- Worker modularisatieplan bijwerken: docs/worker-modularization-plan.md (auto-maintained)
- Nieuwe dataverzameling/agents alleen na architectuurcriteria: docs/agent-data-collection-policy.md (guardrail-active)

## Volgende aanbevelingen
1. Database credentials activeren en schema toepassen (Hoog, impact: Zeer hoog) - Het migratieplan is nu vastgelegd; de volgende stap is DATABASE_URL/POSTGRES_URL koppelen en npm run db:schema:apply draaien.
2. H2H/result-contract bewaken met regressietests (Hoog, impact: Hoog) - H2H-dekking staat op 86%; voorkom terugval door worker/API/client-contracten automatisch te testen.
3. Resultaatbackfill schoon houden (Middel, impact: Middel) - De audit meldt 0 pending backfills; behoud dit met automatische bronvergelijking na iedere worker-run.
4. Snapshot-training naar 150 rows opschalen (Middel, impact: Hoog) - 76 snapshot-backed rows is volwassen; volgende kwaliteitsdoel is 150 voor stabielere league/phase-kalibratie.
5. Odds en closing-line kalibratie live beoordelen (Middel, impact: Hoog) - ROI/CLV is pas betrouwbaar zodra echte odds_at_prediction en closing odds consequent binnenkomen.

## Reviewbranch voorstel
- codex/review-20260603
- AI reviewvoorstel voor 2026-06-03: 1 aandachtspunt(en) met patchadvies, niet automatisch live.

## Mailstatus
- Mailverzending vereist nog aparte mailcredentials of een mailservice. De bundel wordt nu wel automatisch opgebouwd en opgeslagen.
