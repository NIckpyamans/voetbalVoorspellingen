#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const FINDINGS_FILE = path.join(ROOT, "monitor", "daily-findings.json");
const PROPOSAL_FILE = path.join(ROOT, "monitor", "review-branch-proposal.json");
const DATA_QUALITY_FILE = path.join(ROOT, "monitor", "data-quality-audit.json");
const WIDGET_AUDIT_FILE = path.join(ROOT, "monitor", "widget-integration-audit.json");
const PREDICTION_EVALUATION_FILE = path.join(ROOT, "monitor", "prediction-evaluation-report.json");
const SNAPSHOT_GROWTH_FILE = path.join(ROOT, "monitor", "snapshot-growth-monitor.json");
const PROFESSIONAL_AUDIT_FILE = path.join(ROOT, "monitor", "ai-professional-audit.json");
const LINEUP_MONITOR_FILE = path.join(ROOT, "monitor", "lineup-availability-monitor.json");
const API_FOOTBALL_ACCEPTANCE_FILE = path.join(ROOT, "monitor", "api-football-provider-acceptance.json");
const OUTPUT_JSON = path.join(ROOT, "monitor", "biweekly-review-digest.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "biweekly-review-digest.md");
const DATABASE_PLAN_MD = path.join(ROOT, "docs", "database-migration-plan.md");
const WORKER_PLAN_MD = path.join(ROOT, "docs", "worker-modularization-plan.md");
const AGENT_POLICY_MD = path.join(ROOT, "docs", "agent-data-collection-policy.md");
const DATA_CONTEXT_DIR = path.join(ROOT, "docs", "data-context");

const architectureFindings = [
  {
    key: "worker_monolith",
    title: "Worker-core blijft te groot",
    problem: "Data collection, validatie, prediction, archivering en datumlogica zijn deels opgesplitst, maar scripts/server-worker.js blijft de grote orkestratielaag.",
    cause: "De eerste veilige module-extracties zijn uitgevoerd; veel domeinlogica is nog gekoppeld aan de centrale store.",
    risk: "Nieuwe competities, databronnen en modellen worden moeilijk testbaar en vergroten regressierisico.",
    solution: "Ga verder met kleine domeinextracties en voeg per module contracttests toe.",
    priority: "Hoog",
    expectedImpact: "Zeer hoog",
  },
  {
    key: "storage_tiering",
    title: "R2/Neon-opslaglagen moeten aantoonbaar synchroon blijven",
    problem: "R2 houdt snapshots en captures beschikbaar wanneer Neon quota blokkeert, maar relationele replay kan daardoor achterlopen.",
    cause: "Neon is de relationele kern en R2 is archief/fallback; beide lagen hebben een herstelcontract nodig.",
    risk: "Dashboard en evaluatie blijven werken, terwijl relationele dekking ongemerkt veroudert.",
    solution: "Test R2 dagelijks, meet Neon-beschikbaarheid en replay critical captures automatisch zodra Neon herstelt.",
    priority: "Hoog",
    expectedImpact: "Zeer hoog",
  },
  {
    key: "provider_coverage_gates",
    title: "Providerdekking blijft de modelkwaliteit begrenzen",
    problem: "H2H, confirmed lineups en timestamped odds zijn niet voor iedere gevolgde competitie beschikbaar.",
    cause: "Gratis providers hebben verschillende competitie-, tijdvenster- en quotabeperkingen.",
    risk: "Voorspellingen krijgen een te vergelijkbare confidence terwijl de onderliggende bronkwaliteit verschilt.",
    solution: "Meet dekking per veld en competitie, bewaar missing reasons en stuur alleen gerichte fallbackjobs aan.",
    priority: "Hoog",
    expectedImpact: "Zeer hoog",
  },
  {
    key: "audit_evidence_freshness",
    title: "Auditbewijs moet na iedere hersteljob worden vastgelegd",
    problem: "Een workflow kan groen zijn terwijl het bijbehorende monitorrapport in Git verouderd blijft.",
    cause: "Sommige specialistische workflows uploaden alleen tijdelijke artifacts.",
    risk: "Een latere analyse baseert prioriteiten op oude coverage- of quotacijfers.",
    solution: "Commit compacte, niet-gevoelige monitorrapporten met retries na iedere auditgestuurde hersteljob.",
    priority: "Hoog",
    expectedImpact: "Hoog",
  },
  {
    key: "model_calibration_weak",
    title: "Modelkalibratie is zwak",
    problem: "League- en phase-profielen hebben verschillende aantallen unieke reviews en niet ieder segment verbetert de Brier-score.",
    cause: "Reguliere competities, kwalificaties en friendlies hebben aantoonbaar verschillende foutprofielen.",
    risk: "Dashboard kan te zeker ogen terwijl real-world hitrates achterblijven.",
    solution: "Kalibreer in shadow mode per league/phase en promoveer alleen bij voldoende unieke wedstrijden en meetbare Brier-verbetering.",
    priority: "Hoog",
    expectedImpact: "Hoog",
  },
];

const standardActions = [
  {
    key: "database_migration_plan",
    title: "Database migratieplan bijwerken",
    status: "auto-maintained",
    output: "docs/database-migration-plan.md",
  },
  {
    key: "worker_modularization_plan",
    title: "Worker modularisatieplan bijwerken",
    status: "auto-maintained",
    output: "docs/worker-modularization-plan.md",
  },
  {
    key: "agent_data_collection_policy",
    title: "Nieuwe dataverzameling/agents alleen na architectuurcriteria",
    status: "guardrail-active",
    output: "docs/agent-data-collection-policy.md",
  },
  {
    key: "data_context",
    title: "Herbruikbare data context bewaken",
    status: "context-active",
    output: "docs/data-context/analysis-context.json",
  },
];

function writeStandardActionDocs(generatedAt) {
  writeText(
    DATABASE_PLAN_MD,
    [
      "# Database Migratieplan",
      "",
      `Laatst bijgewerkt: ${generatedAt}`,
      "",
      "## Doel",
      "Maak Postgres/Supabase de bron van waarheid voor een schaalbaar voetbal intelligence platform. JSON blijft alleen cache, export of fallback.",
      "",
      "## Fase 1 - Fundament",
      "- Maak tabellen voor countries, competitions, competition_seasons, clubs, club_aliases, venues en matches.",
      "- Voeg source_records toe voor ruwe bronpayloads met provider, fetched_at, source_url, content_hash en trust_score.",
      "- Voeg source_audit toe per genormaliseerd veld zodat iedere voorspelling herleidbaar blijft.",
      "- Voeg model_versions en calibration_profiles toe om modelruns reproduceerbaar te maken.",
      "",
      "## Fase 2 - Wedstrijddata",
      "- Breid matches uit met season_id, competition_id, home_club_id, away_club_id en status_normalized.",
      "- Maak match_results, match_stats en team_match_stats voor eindstand, ruststand, xG, shots, cards, corners en possession.",
      "- Maak h2h_edges voor onderlinge historie per clubpaar en competitiecontext.",
      "- Bewaar RESULT_PENDING, CANCELLED en POSTPONED als statussen, niet als ontbrekende scores.",
      "",
      "## Fase 3 - Seizoenbeheer",
      "- Maak standings_snapshots, team_season_stats en season_archives.",
      "- Maak players, squads, injuries en suspensions voor selectiecontext per seizoen en wedstrijd.",
      "- Archiveer bij seizoenafsluiting standings, fixtures, resultaten, predictions en modelevaluaties immutable.",
      "- Open automatisch het volgende seizoen op basis van competition calendar en status.",
      "",
      "## Fase 4 - Prediction Ledger",
      "- Behoud prediction_snapshots, odds_snapshots, match_results en prediction_evaluations.",
      "- Voeg model_versions, calibration_profiles en feature_vectors toe voor reproduceerbare modelruns.",
      "- ROI/CLV pas activeren bij echte odds_at_prediction plus closing odds.",
      "",
      "## Migratieregels",
      "- Geen historische JSON-data verwijderen voordat database-import is gevalideerd.",
      "- Iedere import moet idempotent zijn op provider_id of canonical_match_key.",
      "- Iedere wijziging moet readiness, regression en datakwaliteitchecks doorstaan.",
      "",
      "## Secrets-gate",
      "- DATABASE_URL, POSTGRES_URL of SUPABASE_DB_URL moet gevuld zijn voordat `npm run db:schema:apply` wordt uitgevoerd.",
      "- ODDS_API_KEY of THE_ODDS_API_KEY moet gevuld zijn voordat ROI/CLV live wordt beoordeeld.",
      "- Zie docs/secrets-readiness-checklist.md voor de actuele checklist.",
      "",
    ].join("\n")
  );

  writeText(
    WORKER_PLAN_MD,
    [
      "# Worker Modularisatieplan",
      "",
      `Laatst bijgewerkt: ${generatedAt}`,
      "",
      "## Doel",
      "Splits scripts/server-worker.js zonder voorspelgedrag te veranderen. Iedere stap behoudt dezelfde output in server_data.json en data/*.json.",
      "",
      "## Doelmodules",
      "- scripts/worker/data-collection.js: bronnen ophalen, fetch timeouts, rate-limit circuits, OpenFootball, Understat, FBref en source diagnostics. BBC/ESPN volgen apart.",
      "- shared/matchNormalization.js + scripts/worker/validation.js: teamnamen, statussen, score parsing, dedupe, result backfill en H2H-contracten. Eerste stap is actief.",
      "- feature-builder: vorm, H2H, xG, ELO, lineups, injuries, weather, market features.",
      "- scripts/worker/prediction.js: Poisson, Monte Carlo, ensemble, scorematrix, 1X2-calibratie. Eerste pure math-stap is actief.",
      "- scripts/worker/learning.js: post-match reviews, Brier/log loss, ROI/CLV, calibration profiles.",
      "- scripts/worker/archive.js: JSON export, competition archives, standings snapshots en later database writes.",
      "",
      "## Veilige volgorde",
      "1. Extract pure helpers zonder side effects.",
      "2. Voeg contracttests toe op bestaande worker-output.",
      "3. Verplaats normalisatie naar shared module. Eerste stap is actief via shared/matchNormalization.js.",
      "4. Verplaats storage/archive-output. Eerste stap is actief via scripts/worker/archive.js.",
      "5. Verplaats prediction-engine pas na snapshot/regression lock. Eerste pure math-stap is actief via scripts/worker/prediction.js.",
      "6. Activeer database writes pas als JSON-output identiek blijft.",
      "7. Verplaats BBC/ESPN event-fetchers apart, inclusief logo-cache en status/minute mapping tests.",
      "",
      "## Gedragsregels",
      "- Geen nieuwe databronnen tijdens extractie.",
      "- Geen modelgewicht aanpassen tijdens modularisatie.",
      "- Elke stap moet npm run check, readiness, regressions en build halen.",
      "",
    ].join("\n")
  );

  writeText(
    AGENT_POLICY_MD,
    [
      "# Agent- en Datacollectiebeleid",
      "",
      `Laatst bijgewerkt: ${generatedAt}`,
      "",
      "## Principe",
      "Voeg alleen agents of databronnen toe als ze meetbaar betere dekking, betrouwbaarheid of modelprestatie geven.",
      "",
      "## Toegestane agents",
      "- Data Collection Agent: deterministic service voor bronfetching en source diagnostics.",
      "- Data Validation Agent: controleert scores, H2H, team IDs, status en bronconflicten.",
      "- Prediction Agent: bestaande modelkern, modulair en reproduceerbaar.",
      "- Season Archive Agent: sluit seizoenen af en opent nieuwe seizoenen zonder dataverlies.",
      "- Self Improvement Agent: adviseert en prioriteert, maar wijzigt niet blind productiegedrag.",
      "",
      "## Niet toestaan",
      "- Agents die dezelfde bron opnieuw ophalen zonder hogere betrouwbaarheid.",
      "- LLM-agents voor deterministische datanormalisatie.",
      "- Nieuwe bronnen zonder rate-limit, bronkwaliteit en fallbackbeleid.",
      "",
      "## Acceptatiecriteria voor nieuwe bron",
      "- Providernaam, licentie/gebruik, rate-limit en dekking zijn vastgelegd.",
      "- Source timestamp en fetched_at worden opgeslagen.",
      "- Conflicten worden door Data Validation opgelost of als anomaly gemarkeerd.",
      "- Geen modelgewicht op nieuwe bron voordat minimaal 50 gevalideerde reviews beschikbaar zijn.",
      "",
    ].join("\n")
  );
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function getAmsterdamDate(input = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(input);
}

function subtractDays(dateString, days) {
  const base = new Date(`${dateString}T12:00:00`);
  base.setDate(base.getDate() - days);
  return getAmsterdamDate(base);
}

function toTitle(key) {
  const labels = {
    live_minute_missing: "Live minuten missen",
    h2h_empty: "H2H niet gevuld",
    cupsheets_empty: "Bekerschema leeg",
    standings_empty: "Standen missen",
    dashboard_wrong_day: "Verkeerde speeldag op dashboard",
    duplicate_minute_logic: "Minute-logica nog dubbel",
    logo_fallback_missing: "Logo fallback mist",
    phase_reliability_empty: "Fasebetrouwbaarheid ontbreekt",
    bookmaker_signals_missing: "Bookmakersignalen missen",
    historical_referee_unmatched: "Historische scheidsdata matcht te weinig",
    referee_alias_cache_missing: "Referee alias-cache te smal",
    bookmaker_signal_logic_missing: "Bookmaker-calibratie te smal",
    phase_buckets_missing: "Fasebuckets missen",
    worker_stale: "Workerdata verouderd",
    worker_last_run_missing: "Laatste worker-run ontbreekt",
    today_matches_empty: "Geen speeldagdata",
    fixture_calendar_source_gap: "Fixturekalender onzeker",
    server_data_missing: "server_data ontbreekt",
    minute_helper_missing: "Minute-helper ontbreekt",
  };
  return labels[key] || key.replaceAll("_", " ");
}

function recommendationFor(key) {
  const map = {
    h2h_empty: "Trek H2H verder uit historische competitiebestanden en bewaak fallbackdekking in de worker.",
    bookmaker_signals_missing: "Verbred de interland-oddsbron en toon dekking per bookmaker in de kaart.",
    historical_referee_unmatched: "Trek bredere referee-archieven per land/competitie in cache en onderhoud aliasen.",
    duplicate_minute_logic: "Houd minute parsing centraal in de helper en verwijder resterende duplicaten.",
    today_matches_empty: "Controleer brondekking en dagfilter in de worker voor vandaag + morgen.",
    fixture_calendar_source_gap: "Controleer kalenderfallbacks; 0 wedstrijden is alleen ok als de worker dat kan verklaren.",
  };
  return map[key] || "Gebruik het reviewbranch-voorstel als veilige volgende patchronde.";
}

function buildDigest() {
  const generatedAt = new Date().toISOString();
  writeStandardActionDocs(generatedAt);

  const findings = readJsonSafe(FINDINGS_FILE, { days: {} });
  const proposal = readJsonSafe(PROPOSAL_FILE, null);
  const dataQuality = readJsonSafe(DATA_QUALITY_FILE, null);
  const widgetAudit = readJsonSafe(WIDGET_AUDIT_FILE, null);
  const predictionEvaluation = readJsonSafe(PREDICTION_EVALUATION_FILE, null);
  const snapshotGrowth = readJsonSafe(SNAPSHOT_GROWTH_FILE, null);
  const professionalAudit = readJsonSafe(PROFESSIONAL_AUDIT_FILE, null);
  const lineupMonitor = readJsonSafe(LINEUP_MONITOR_FILE, null);
  const apiFootballAcceptance = readJsonSafe(API_FOOTBALL_ACCEPTANCE_FILE, null);
  const allFindingDays = Object.keys(findings.days || {}).sort();
  const latestFindingDay = allFindingDays.at(-1) || getAmsterdamDate();
  const lookbackDays = Math.max(1, Number(process.env.AUDIT_LOOKBACK_DAYS || 7));
  const fromDate = subtractDays(latestFindingDay, lookbackDays - 1);
  const includedDays = Object.keys(findings.days || {})
    .filter((key) => key >= fromDate && key <= latestFindingDay)
    .sort();

  const runs = includedDays.flatMap((key) => findings.days?.[key]?.runs || []);
  const issueMap = new Map();
  let totalRuns = 0;
  let totalIssues = 0;
  let latestStats = {};

  for (const day of includedDays) {
    const dayRuns = findings.days?.[day]?.runs || [];
    totalRuns += dayRuns.length;
    if (dayRuns.length) latestStats = dayRuns.at(-1)?.stats || latestStats;
    for (const run of dayRuns) {
      for (const issue of run.issues || []) {
        totalIssues += 1;
        const current = issueMap.get(issue.key) || {
          key: issue.key,
          title: toTitle(issue.key),
          count: 0,
          highestSeverity: "low",
          sampleMessage: issue.message,
        };
        current.count += 1;
        if (issue.severity === "high" || (issue.severity === "medium" && current.highestSeverity === "low")) {
          current.highestSeverity = issue.severity;
        }
        issueMap.set(issue.key, current);
      }
    }
  }

  const topFindings = [...issueMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((item) => ({
      ...item,
      recommendation: recommendationFor(item.key),
    }));

  const shouldRefresh = true;
  const dataQualityTotals = dataQuality?.totals || {};
  const h2hCoverage = Number(dataQualityTotals.h2hCoverage || 0);
  const regularLeagueGate = snapshotGrowth?.training?.regularLeagueGate || {};
  const confirmedLineupCoverage = Number(
    professionalAudit?.recent?.confirmedLineupCoverage ?? lineupMonitor?.confirmedLineupCoverage ?? 0
  );
  const actualOddsCoverage = Number(professionalAudit?.recent?.actualOddsCoverage || 0);
  const neonError = String(snapshotGrowth?.database?.error || lineupMonitor?.database?.error || "");
  const neonQuotaBlocked = /\b402\b|quota/i.test(neonError);
  const apiFootballAccepted = apiFootballAcceptance?.accepted === true;
  const actionPlan = [
    {
      key: "h2h_coverage",
      title: "H2H-dekking gericht verhogen",
      priority: "Hoog",
      expectedImpact: "Hoog",
      metric: h2hCoverage,
      target: 0.85,
      workflow: "h2h-enrichment.yml",
      reason: `Actuele H2H-dekking is ${Math.round(h2hCoverage * 100)}%; doel is minimaal 85% met betrouwbare historie en expliciete missing reasons.`,
    },
    {
      key: "confirmed_lineups",
      title: "Confirmed lineups rond kickoff verzamelen",
      priority: "Hoog",
      expectedImpact: "Zeer hoog",
      metric: confirmedLineupCoverage,
      target: 0.45,
      workflow: "pre-kickoff-lineups.yml",
      reason: `Confirmed-lineupdekking is ${Math.round(confirmedLineupCoverage * 100)}%; T-75, T-45 en T-20 blijven de actieve capturevensters.`,
    },
    {
      key: "timestamped_odds",
      title: "Opening-, prematch- en closing odds vastleggen",
      priority: "Hoog",
      expectedImpact: "Zeer hoog",
      metric: actualOddsCoverage,
      target: 0.6,
      workflow: "free-prematch-odds.yml",
      reason: `Echte oddsdekking is ${Math.round(actualOddsCoverage * 100)}%; CLV/ROI blijft geblokkeerd zonder geldige timestamped paren.${apiFootballAccepted ? "" : " API-Football accepteert het huidige plan nog niet."}`,
    },
    {
      key: "storage_recovery",
      title: "R2/Neon-herstelketen controleren",
      priority: neonQuotaBlocked ? "Hoog" : "Middel",
      expectedImpact: "Hoog",
      metric: neonQuotaBlocked ? 0 : 1,
      target: 1,
      workflow: "storage-recovery.yml",
      reason: neonQuotaBlocked
        ? "Neon is geconfigureerd maar blokkeert met HTTP 402/quota; R2 blijft actief en replay moet automatisch hervatten na herstel."
        : "Controleer R2-canary, Neon-beschikbaarheid en replay van critical captures.",
    },
    {
      key: "league_phase_shadow",
      title: "League/phase-kalibratie in shadow mode beoordelen",
      priority: "Middel",
      expectedImpact: "Hoog",
      metric: Number(regularLeagueGate.uniqueCompletedMatches || 0),
      target: Number(regularLeagueGate.calibrationMin || 50),
      workflow: "nightly-model-maintenance.yml",
      reason: regularLeagueGate.canCalibrate
        ? `${Number(regularLeagueGate.uniqueCompletedMatches || 0)} unieke reguliere wedstrijden; gate gehaald. Promoveer alleen profielen met voldoende Brier-verbetering.`
        : `Nog ${Number(regularLeagueGate.gap || 0)} reguliere wedstrijden nodig voordat league-kalibratie betrouwbaar is.`,
    },
  ];
  const nextRecommendations = actionPlan.map(({ workflow, ...recommendation }) => recommendation);
  const digest = {
    generatedAt,
    range: {
      from: fromDate,
      to: latestFindingDay,
      days: includedDays.length,
    },
    shouldNotify: false,
    shouldRefresh,
    cadence: "5x per maand",
    summary:
      topFindings.length > 0
        ? `AI bundel over de laatste ${lookbackDays} dagen: ${topFindings.length} monitorthema's en ${actionPlan.length} uitvoerbare verbeteracties.`
        : `Geen nieuwe dagelijkse alarmsignalen; ${actionPlan.length} meetbare verbeteracties blijven actief.`,
    totals: {
      totalRuns,
      totalIssues,
      uniqueIssueTypes: topFindings.length,
    },
    latestStats,
    topFindings,
    dataQuality: dataQuality
      ? {
          generatedAt: dataQuality.generatedAt,
          totals: dataQuality.totals,
          status: dataQuality.status,
          recommendations: dataQuality.recommendations || [],
        }
      : null,
    widgetAudit,
    predictionEvaluation: predictionEvaluation
      ? {
          generatedAt: predictionEvaluation.generatedAt,
          status: predictionEvaluation.status,
          outcome: predictionEvaluation.outcome,
          sources: predictionEvaluation.sources,
          totals: predictionEvaluation.totals,
        }
      : null,
    snapshotGrowth: snapshotGrowth
      ? {
          generatedAt: snapshotGrowth.generatedAt,
          training: snapshotGrowth.training,
          database: snapshotGrowth.database,
          snapshotSources: snapshotGrowth.snapshotSources,
        }
      : null,
    architectureAudit: {
      generatedAt,
      summary:
        "Professionele architectuuranalyse voor schaalbaarheid, datakwaliteit, AI-agentwaarde, databasegroei en modelbetrouwbaarheid.",
      findings: architectureFindings,
      standardActions,
      nextRecommendations,
    },
    standardActions,
    nextRecommendations,
    actionPlan,
    executionPolicy: {
      automatic: true,
      maxActionsPerAudit: 5,
      note: "Alleen bestaande, idempotente GitHub-workflows worden gestart; externe abonnementen of modelpromoties worden nooit geforceerd.",
    },
    reviewProposal:
      proposal && proposal.shouldPropose
        ? {
            branchName: proposal.branchName,
            summary: proposal.summary,
            recommendedFiles: proposal.recommendedFiles || [],
          }
        : null,
    delivery: {
      emailConfigured: false,
      note: "Mailverzending vereist nog aparte mailcredentials of een mailservice. De bundel wordt nu wel automatisch opgebouwd en opgeslagen.",
    },
  };

  const md = [
    "# FootyAI verbeteraudit",
    "",
    `Periode: ${fromDate} t/m ${latestFindingDay}`,
    "",
    digest.summary,
    "",
    `- Runs: ${totalRuns}`,
    `- Bevindingen: ${totalIssues}`,
    `- Thema's: ${topFindings.length}`,
    "",
    "## Hoofdpunten",
    ...topFindings.flatMap((item) => [
      `- ${item.title} (${item.count}x, severity: ${item.highestSeverity})`,
      `  - ${item.recommendation}`,
    ]),
    "",
    "## Architectuuranalyse",
    digest.architectureAudit.summary,
    "",
    ...architectureFindings.flatMap((item) => [
      `- ${item.title} (${item.priority}, impact: ${item.expectedImpact})`,
      `  - Probleem: ${item.problem}`,
      `  - Oorzaak: ${item.cause}`,
      `  - Risico: ${item.risk}`,
      `  - Oplossing: ${item.solution}`,
    ]),
    "",
    dataQuality
      ? `## Datakwaliteit\n- Pending result backfills: ${Number(dataQuality?.totals?.pendingResultBackfills || 0)}\n- Ontbrekende oude scores: ${Number(dataQuality?.totals?.missingPastScores || 0)}\n- H2H-dekking: ${Math.round(Number(dataQuality?.totals?.h2hCoverage || 0) * 100)}%\n${(dataQuality.recommendations || []).map((item) => `- ${item}`).join("\n")}`
      : "## Datakwaliteit\n- Nog geen data-quality audit beschikbaar. Draai npm run monitor:data-quality.",
    "",
    widgetAudit
      ? `## Widgetintegraties\n- Status: ${widgetAudit.status}\n- Neon: ${widgetAudit.neon?.connected ? "verbonden" : "niet verbonden"}\n- Checks: ${widgetAudit.totals?.passed || 0}/${widgetAudit.totals?.checks || 0} geslaagd\n${(widgetAudit.opportunities || []).map((item) => `- ${item}`).join("\n")}`
      : "## Widgetintegraties\n- Nog geen widget-audit beschikbaar. Draai npm run monitor:widgets.",
    "",
    predictionEvaluation
      ? `## Snapshot-evaluatie\n- Status: ${predictionEvaluation.status} (${predictionEvaluation.outcome})\n- Neon: ${predictionEvaluation.sources?.neon?.available ? "beschikbaar" : "fallback actief"}\n- R2: ${Number(predictionEvaluation.sources?.r2?.snapshotsRead || 0)} gelezen, ${Number(predictionEvaluation.sources?.r2?.evaluated || 0)} geëvalueerd\n- Lokale fallback: ${Number(predictionEvaluation.sources?.fallback?.snapshotsRead || 0)} gelezen, ${Number(predictionEvaluation.sources?.fallback?.evaluated || 0)} geëvalueerd\n- Werkelijk geëvalueerd: ${Number(predictionEvaluation.totals?.evaluatedThisRun || 0)}`
      : "## Snapshot-evaluatie\n- Nog geen evaluatierapport beschikbaar.",
    "",
    snapshotGrowth
      ? `## Snapshotgroei\n- Snapshotrecords: ${Number(snapshotGrowth.training?.snapshotBackedRows || 0)}\n- Unieke snapshotwedstrijden: ${Number(snapshotGrowth.training?.uniqueSnapshotMatches || 0)}/${Number(snapshotGrowth.training?.target || 150)}\n- Resterend: ${Number(snapshotGrowth.training?.gap || 0)}\n- Samengevoegde snapshotbron: ${Number(snapshotGrowth.snapshotSources?.merged?.clubSnapshots || 0)} club-snapshots`
      : "## Snapshotgroei\n- Nog geen groeirapport beschikbaar.",
    "",
    "## Standaard uitgevoerde acties",
    ...standardActions.map((item) => `- ${item.title}: ${item.output} (${item.status})`),
    "",
    "## Volgende aanbevelingen",
    ...nextRecommendations.map(
      (item, index) => `${index + 1}. ${item.title} (${item.priority}, impact: ${item.expectedImpact}) - ${item.reason}`
    ),
    "",
    "## Automatisch gestarte acties",
    ...actionPlan.map((item, index) => `${index + 1}. ${item.title}: ${item.workflow}`),
    "",
    proposal?.shouldPropose
      ? `## Reviewbranch voorstel\n- ${proposal.branchName}\n- ${proposal.summary}`
      : "## Reviewbranch voorstel\n- Geen voorstel nodig.",
    "",
    "## Mailstatus",
    `- ${digest.delivery.note}`,
    "",
  ].join("\n");

  writeJson(OUTPUT_JSON, digest);
  writeText(OUTPUT_MD, md);
  process.stdout.write(JSON.stringify(digest, null, 2) + "\n");
}

buildDigest();
