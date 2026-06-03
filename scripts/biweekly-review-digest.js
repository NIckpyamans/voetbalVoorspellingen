#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const FINDINGS_FILE = path.join(ROOT, "monitor", "daily-findings.json");
const PROPOSAL_FILE = path.join(ROOT, "monitor", "review-branch-proposal.json");
const OUTPUT_JSON = path.join(ROOT, "monitor", "biweekly-review-digest.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "biweekly-review-digest.md");
const DATABASE_PLAN_MD = path.join(ROOT, "docs", "database-migration-plan.md");
const WORKER_PLAN_MD = path.join(ROOT, "docs", "worker-modularization-plan.md");
const AGENT_POLICY_MD = path.join(ROOT, "docs", "agent-data-collection-policy.md");

const architectureFindings = [
  {
    key: "worker_monolith",
    title: "Worker is monolithisch",
    problem: "De worker bevat data collection, validatie, prediction, learning, archivering en storage in een enkel bestand.",
    cause: "Snelle iteratie heeft alle domeinen samengebracht in scripts/server-worker.js.",
    risk: "Nieuwe competities, databronnen en modellen worden moeilijk testbaar en vergroten regressierisico.",
    solution: "Splits de worker gefaseerd in domeinmodules met gelijkblijvende input/output-contracten.",
    priority: "Hoog",
    expectedImpact: "Zeer hoog",
  },
  {
    key: "json_primary_storage",
    title: "JSON is nog primaire datastore",
    problem: "server_data.json is groot en groeit lineair mee met wedstrijden, reviews en snapshots.",
    cause: "GitHub JSON fungeert nu als bron van waarheid en distributielaag tegelijk.",
    risk: "Miljoenen wedstrijden zijn niet haalbaar met grote JSON-commits en serverless JSON-parsing.",
    solution: "Maak Postgres/Supabase primair en behoud JSON alleen als cache/exportlaag.",
    priority: "Hoog",
    expectedImpact: "Zeer hoog",
  },
  {
    key: "database_schema_too_narrow",
    title: "Database-schema is nog prediction-ledger",
    problem: "Het schema mist genormaliseerde competities, clubs, seizoenen, teamstatistieken en source records.",
    cause: "Het huidige schema is ontworpen rond predictions en evaluaties, niet rond een volledige football intelligence graph.",
    risk: "Seizoenbeheer, historische standen en bronherleidbaarheid worden later duur om te herstellen.",
    solution: "Breid het schema uit met competition, club, season, match stats, source lineage en archive-tabellen.",
    priority: "Hoog",
    expectedImpact: "Zeer hoog",
  },
  {
    key: "duplicate_normalization",
    title: "Dubbele normalisatie/backfill",
    problem: "Result-backfill en dedupe staan in worker, API en clientservice.",
    cause: "Noodvangnetten zijn op meerdere lagen toegevoegd.",
    risk: "Verschillende lagen kunnen andere eindstanden of matchidentiteiten tonen.",
    solution: "Centraliseer normalisatie in een gedeelde module en laat API/client alleen consumeren.",
    priority: "Hoog",
    expectedImpact: "Hoog",
  },
  {
    key: "model_calibration_weak",
    title: "Modelkalibratie is zwak",
    problem: "Live analyse meldt een kalibratiefout rond 0.206 en exact-score hitrate rond 12%.",
    cause: "Exact-score selectie, confidence en 1X2-probabilities worden nog niet volledig op echte odds en closing lines gekalibreerd.",
    risk: "Dashboard kan te zeker ogen terwijl real-world hitrates achterblijven.",
    solution: "Kalibreer per league/phase/model en gebruik echte odds pas zodra odds_at_prediction betrouwbaar is.",
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
      "",
      "## Fase 2 - Wedstrijddata",
      "- Breid matches uit met season_id, competition_id, home_club_id, away_club_id en status_normalized.",
      "- Maak match_results, match_stats en team_match_stats voor eindstand, ruststand, xG, shots, cards, corners en possession.",
      "- Bewaar RESULT_PENDING, CANCELLED en POSTPONED als statussen, niet als ontbrekende scores.",
      "",
      "## Fase 3 - Seizoenbeheer",
      "- Maak standings_snapshots, team_season_stats en season_archives.",
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
      "- data-collection: bronnen ophalen, rate limits, retries, source diagnostics.",
      "- normalization: teamnamen, statussen, scores, dedupe, result backfill.",
      "- feature-builder: vorm, H2H, xG, ELO, lineups, injuries, weather, market features.",
      "- prediction-engine: Poisson, Monte Carlo, ensemble, scorematrix, 1X2-calibratie.",
      "- evaluation-learning: post-match reviews, Brier/log loss, ROI/CLV, calibration profiles.",
      "- season-archive: competition archives, standings snapshots, season rollover.",
      "- storage-writer: JSON export en later database writes.",
      "",
      "## Veilige volgorde",
      "1. Extract pure helpers zonder side effects.",
      "2. Voeg contracttests toe op bestaande worker-output.",
      "3. Verplaats normalisatie naar shared module.",
      "4. Verplaats prediction-engine pas na snapshot/regression lock.",
      "5. Activeer database writes pas als JSON-output identiek blijft.",
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

function getIsoWeek(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
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
  const allFindingDays = Object.keys(findings.days || {}).sort();
  const latestFindingDay = allFindingDays.at(-1) || getAmsterdamDate();
  const fromDate = subtractDays(latestFindingDay, 13);
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

  const week = getIsoWeek(latestFindingDay);
  const shouldRefresh = week % 2 === 0;
  const nextRecommendations = [
    {
      title: "Database credentials activeren en schema toepassen",
      priority: "Hoog",
      expectedImpact: "Zeer hoog",
      reason: "Het migratieplan is nu vastgelegd; de volgende stap is DATABASE_URL/POSTGRES_URL koppelen en npm run db:schema:apply draaien.",
    },
    {
      title: "Resultaat- en H2H-normalisatie centraliseren",
      priority: "Hoog",
      expectedImpact: "Hoog",
      reason: "Dit verlaagt risico op conflicterende eindstanden tussen worker, API en client.",
    },
    {
      title: "Openstaande resultaatbackfills opschonen",
      priority: "Hoog",
      expectedImpact: "Hoog",
      reason: "Pending eindstanden remmen learning, modelkalibratie en dashboardvertrouwen.",
    },
    {
      title: "Snapshot-training uitbreiden",
      priority: "Middel",
      expectedImpact: "Hoog",
      reason: "Minimaal 50 betrouwbare snapshot-backed rows zijn nodig voordat zelflerende gewichten volwassen worden.",
    },
    {
      title: "Odds en closing-line kalibratie live beoordelen",
      priority: "Middel",
      expectedImpact: "Hoog",
      reason: "ROI/CLV is pas betrouwbaar zodra echte odds_at_prediction en closing odds consequent binnenkomen.",
    },
  ];
  const digest = {
    generatedAt,
    range: {
      from: fromDate,
      to: latestFindingDay,
      days: includedDays.length,
    },
    shouldNotify: false,
    shouldRefresh,
    cadence: "tweewekelijks",
    summary:
      topFindings.length > 0
        ? `AI bundel over de laatste 14 dagen: ${topFindings.length} hoofdthema's uit ${totalIssues} monitorbevindingen.`
        : "Geen opvallende AI-verbeterpunten in de laatste 14 dagen.",
    totals: {
      totalRuns,
      totalIssues,
      uniqueIssueTypes: topFindings.length,
    },
    latestStats,
    topFindings,
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
    "# FootyAI tweewekelijkse AI-digest",
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
    "## Standaard uitgevoerde acties",
    ...standardActions.map((item) => `- ${item.title}: ${item.output} (${item.status})`),
    "",
    "## Volgende aanbevelingen",
    ...nextRecommendations.map(
      (item, index) => `${index + 1}. ${item.title} (${item.priority}, impact: ${item.expectedImpact}) - ${item.reason}`
    ),
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
