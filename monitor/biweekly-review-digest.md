# FootyAI tweewekelijkse AI-digest

Periode: 2026-07-03 t/m 2026-07-16

AI bundel over de laatste 14 dagen: 1 hoofdthema's uit 5 monitorbevindingen.

- Runs: 14
- Bevindingen: 5
- Thema's: 1

## Hoofdpunten
- H2H niet gevuld (5x, severity: medium)
  - Trek H2H verder uit historische competitiebestanden en bewaak fallbackdekking in de worker.

## Architectuuranalyse
Professionele architectuuranalyse voor schaalbaarheid, datakwaliteit, AI-agentwaarde, databasegroei en modelbetrouwbaarheid.

- Worker-core blijft te groot (Hoog, impact: Zeer hoog)
  - Probleem: Data collection, validatie, prediction, archivering en datumlogica zijn deels opgesplitst, maar scripts/server-worker.js blijft de grote orkestratielaag.
  - Oorzaak: De eerste veilige module-extracties zijn uitgevoerd; veel domeinlogica is nog gekoppeld aan de centrale store.
  - Risico: Nieuwe competities, databronnen en modellen worden moeilijk testbaar en vergroten regressierisico.
  - Oplossing: Ga verder met kleine domeinextracties en voeg per module contracttests toe.
- JSON-compatibiliteitslaag blijft te zwaar (Hoog, impact: Zeer hoog)
  - Probleem: Neon is actief, maar server_data.json blijft groot en bevat nog gedeelde workerstatus, reviews en snapshots.
  - Oorzaak: GitHub JSON blijft tegelijk fallback, exportlaag en worker-uitwisselingsformaat.
  - Risico: Miljoenen wedstrijden zijn niet haalbaar met grote JSON-commits en serverless JSON-parsing.
  - Oplossing: Maak Neon per dashboardsectie primair en verklein JSON stapsgewijs tot cache/exportlaag.
- Neon-adoptie is nog onvolledig (Hoog, impact: Zeer hoog)
  - Probleem: Het schema bevat competities, clubs, seizoenen, wedstrijdstatistieken, H2H, source lineage en archives, maar niet iedere widget gebruikt deze tabellen primair.
  - Oorzaak: JSON-fallbacks blijven bewust actief tijdens de gefaseerde migratie.
  - Risico: Widgets kunnen verschillende actualiteit en dekking tonen als Neon en JSON uiteenlopen.
  - Oplossing: Meet database-backed dekking per widget en migreer secties alleen na contractvergelijking met JSON.
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
- H2H-dekking: 26%
- Resultaatbackfill is schoon binnen de auditperiode.
- Breid H2H via historische competitieprofielen en team-id mappings uit tot minimaal 85% dekking.

## Widgetintegraties
- Status: degraded
- Neon: niet verbonden
- Checks: 6/10 geslaagd
- Vul gratis pre-match odds snapshots voordat ROI/CLV wordt beoordeeld.
- Herstel de mislukte widgetcontracten: Neon database, Provider- en integriteitswidget, Dashboard/matches-widget, Prediction-snapshot-widget.

## Snapshot-evaluatie
- Status: completed (evaluated)
- Neon: fallback actief
- R2: 0 gelezen, 0 geëvalueerd
- Lokale fallback: 78 gelezen, 76 geëvalueerd
- Werkelijk geëvalueerd: 76

## Snapshotgroei
- Snapshotrecords: 76
- Unieke snapshotwedstrijden: 5/150
- Resterend: 145
- Samengevoegde snapshotbron: 78 club-snapshots

## Standaard uitgevoerde acties
- Database migratieplan bijwerken: docs/database-migration-plan.md (auto-maintained)
- Worker modularisatieplan bijwerken: docs/worker-modularization-plan.md (auto-maintained)
- Nieuwe dataverzameling/agents alleen na architectuurcriteria: docs/agent-data-collection-policy.md (guardrail-active)
- Herbruikbare data context bewaken: docs/data-context/analysis-context.json (context-active)

## Volgende aanbevelingen
1. Database credentials activeren en schema toepassen (Hoog, impact: Zeer hoog) - Het migratieplan is nu vastgelegd; de volgende stap is DATABASE_URL/POSTGRES_URL koppelen en npm run db:schema:apply draaien.
2. Resultaat- en H2H-normalisatie centraliseren (Hoog, impact: Hoog) - Dit verlaagt risico op conflicterende eindstanden tussen worker, API en client.
3. Resultaatbackfill schoon houden (Middel, impact: Middel) - De audit meldt 0 pending backfills; behoud dit met automatische bronvergelijking na iedere worker-run.
4. Snapshot-training uitbreiden (Middel, impact: Hoog) - 76 snapshots vertegenwoordigen 5 unieke wedstrijden. Minimaal 50 unieke wedstrijden zijn nodig voordat zelflerende gewichten volwassen worden.
5. Odds en closing-line kalibratie live beoordelen (Middel, impact: Hoog) - ROI/CLV is pas betrouwbaar zodra echte odds_at_prediction en closing odds consequent binnenkomen.

## Reviewbranch voorstel
- Geen voorstel nodig.

## Mailstatus
- Mailverzending vereist nog aparte mailcredentials of een mailservice. De bundel wordt nu wel automatisch opgebouwd en opgeslagen.
