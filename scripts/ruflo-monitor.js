#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "server_data.json");
const FINDINGS_FILE = path.join(ROOT, "monitor", "daily-findings.json");
const PROPOSAL_FILE = path.join(ROOT, "monitor", "review-branch-proposal.json");
const DIGEST_FILE = path.join(ROOT, "monitor", "biweekly-review-digest.json");
const RESOLVED_FILE = path.join(ROOT, "monitor", "resolved-recommendations.json");
const OUTPUT_JSON = path.join(ROOT, "monitor", "ruflo-agent-report.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "ruflo-agent-report.md");

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

function amsterdamDate(input = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(input);
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function avg(items) {
  const nums = items.map(Number).filter((value) => Number.isFinite(value));
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function severityScore(priority) {
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function issueKey(item) {
  const value = typeof item === "string" ? item : item?.key || item?.title || item?.message || "unknown";
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function resolvedActionKeys() {
  const resolved = readJsonSafe(RESOLVED_FILE, { resolved: [] });
  return new Set((resolved.resolved || []).map((item) => issueKey(item.title || item)));
}

function filterResolvedActions(actions, resolvedKeys) {
  return (actions || []).filter((action) => !resolvedKeys.has(issueKey(action.title)));
}

function latestMonitorRun(findings) {
  const days = Object.keys(findings.days || {}).sort();
  const latestDay = days.at(-1);
  const runs = latestDay ? findings.days?.[latestDay]?.runs || [] : [];
  return { latestDay, run: runs.at(-1) || null };
}

function allMatches(store) {
  return Object.values(store.matches || {}).flat().filter(Boolean);
}

function allReviews(store) {
  return Object.values(store.postMatchReviews || {}).filter(Boolean);
}

function buildSourceAgents(store, latestRun) {
  const coverage = store.sourceCoverage || {};
  const matches = allMatches(store);
  const todayMatches = Array.isArray(store.matches?.[amsterdamDate()]) ? store.matches[amsterdamDate()] : [];
  const emptyToday = latestRun?.issues?.some((issue) => issue.key === "today_matches_empty") || false;

  const freeSources = [
    {
      name: "SofaScore public endpoint",
      role: "primaire wedstrijddagfeed",
      free: true,
      status: todayMatches.length ? "actief" : "fallback nodig",
      use: "Gebruik als eerste bron, maar behandel 403/lege dagen nooit als eindpunt.",
    },
    {
      name: "TheSportsDB free API",
      role: "fixture-backup voor interlands en cups",
      free: true,
      status: "gekoppeld als backup",
      use: "Breed houden voor dagen waarop de hoofdfeed nationale wedstrijden mist.",
    },
    {
      name: "OpenLigaDB",
      role: "gratis back-up voor Duitse schema's en uitslagen",
      free: true,
      status: "gekoppeld als backup",
      use: "Nuttig voor Bundesliga/2. Bundesliga en als sanity-check op gespeelde uitslagen.",
    },
    {
      name: "football-data.co.uk",
      role: "historische uitslagen, odds, closing line en standings fallback",
      free: true,
      status: "sterkste historische laag",
      use: "Blijven gebruiken voor calibratie, bookmakerweging en ranglijstbackfill.",
    },
    {
      name: "openfootball datasets",
      role: "H2H en historische competitiebestanden",
      free: true,
      status: "backfill laag",
      use: "Vooral inzetten wanneer H2H in live-feed leeg blijft.",
    },
    {
      name: "Understat snapshots",
      role: "xG/xGA pilot voor topcompetities",
      free: true,
      status: Number(coverage.understatCoverage || 0) > 0 ? "deels actief" : "pilot",
      use: "Alleen gebruiken waar parse/snapshot stabiel is; geen harde dependency maken.",
    },
    {
      name: "FBref snapshots",
      role: "shots/home-away splits via snapshot-cache",
      free: true,
      status: Number(coverage.fbrefCoverage || 0) > 0 ? "deels actief" : "rate-limited backup",
      use: "Niet live scrapen op iedere run; alleen gecachte snapshots gebruiken.",
    },
  ];

  const actions = [];
  if (emptyToday || (todayMatches.length === 0 && matches.length > 0)) {
    actions.push({
      priority: "high",
      title: "Wedstrijddag fallbackketen strakker maken",
      freeSolution: "Laat de worker altijd meerdere gratis bronnen proberen: SofaScore -> TheSportsDB -> OpenLigaDB -> football-data/openfootball.",
      files: ["scripts/server-worker.js", "api/Matches.ts"],
      status: "bewaken",
    });
  }
  if (Number(coverage.h2hCoverage || 0) < 0.75) {
    actions.push({
      priority: "medium",
      title: "H2H-backfill verder vullen",
      freeSolution: "Gebruik openfootball en football-data rows per competitie als historische H2H fallback voordat de UI 'leeg' toont.",
      files: ["scripts/server-worker.js", "components/MatchCard.tsx"],
      status: "aanbevolen",
    });
  }
  if (Number(coverage.bookmakerCoverage || 0) < 0.7) {
    actions.push({
      priority: "medium",
      title: "Bookmakerdekking vergroten zonder betaalde API",
      freeSolution: "Gebruik football-data bookmakerkolommen per competitie en bewaar consensus + per-bookmaker betrouwbaarheid in marketProfiles.",
      files: ["scripts/server-worker.js", "types.ts"],
      status: "aanbevolen",
    });
  }
  if (Number(coverage.refereeCoverage || 0) < 0.65) {
    actions.push({
      priority: "low",
      title: "Scheidsrechter-cache slimmer matchen",
      freeSolution: "Combineer referee-naamaliases per land/competitie en laat korte achternaam + initialen fallback meetellen met lagere confidence.",
      files: ["scripts/server-worker.js"],
      status: "aanbevolen",
    });
  }

  return {
    score: Math.round(avg([
      coverage.bookmakerCoverage || 0,
      coverage.refereeCoverage || 0,
      coverage.h2hCoverage || 0,
      coverage.understatCoverage || 0,
      coverage.fbrefCoverage || 0,
    ]) * 100),
    summary: `Datalaag: H2H ${pct(coverage.h2hCoverage)}, bookmakers ${pct(coverage.bookmakerCoverage)}, refs ${pct(coverage.refereeCoverage)}.`,
    freeSources,
    actions,
  };
}

function buildLearningAgents(store) {
  const reviews = allReviews(store);
  const diagnostics = store.featureDiagnostics || {};
  const topConfidence = diagnostics.topConfidence || {};
  const topClubs = Object.values(store.teamLearning || {})
    .filter((team) => Number(team.reviewedMatches || 0) >= 2)
    .sort((a, b) => Number(b.exactHitRate || 0) - Number(a.exactHitRate || 0) || Number(b.reviewedMatches || 0) - Number(a.reviewedMatches || 0))
    .slice(0, 10)
    .map((team) => ({
      teamName: team.teamName,
      reviewedMatches: team.reviewedMatches,
      exactHitRate: team.exactHitRate,
      outcomeHitRate: team.outcomeHitRate,
      avgGoalError: team.avgGoalError,
    }));

  const actions = [];
  if (Number(topConfidence.matches || 0) > 0 && Number(topConfidence.exactHitRate || 0) < 0.16) {
    actions.push({
      priority: "high",
      title: "Top-5 exact-score selectie herwegen",
      freeSolution: "Geef exact-score selectie meer gewicht aan bronkwaliteit, lage goal-error competities en modelagreement; verlaag pure confidence-only weging.",
      files: ["scripts/server-worker.js", "App.tsx"],
      status: "modelactie",
    });
  }
  if (reviews.length >= 25 && Number(diagnostics.outcomeHitRate || 0) < 0.48) {
    actions.push({
      priority: "medium",
      title: "Outcome learning zwaarder laten meewegen",
      freeSolution: "Gebruik teamLearning-bias alleen bij teams met genoeg reviews en temper hem bij interlands/friendlies.",
      files: ["scripts/server-worker.js"],
      status: "modelactie",
    });
  }
  if (Array.isArray(diagnostics.topFailureSignals) && diagnostics.topFailureSignals.length) {
    const top = diagnostics.topFailureSignals[0];
    actions.push({
      priority: Number(top.count || 0) >= 8 ? "high" : "medium",
      title: `Faalsignaal aanpakken: ${top.signal}`,
      freeSolution: "Laat dit signaal terugkomen als penalty in confidence en als uitleg in de matchkaart.",
      files: ["scripts/server-worker.js", "components/MatchCard.tsx"],
      status: "reviewactie",
    });
  }

  return {
    score: Math.round(Number(diagnostics.exactHitRate || 0) * 100),
    summary: `Leerlaag: ${reviews.length} reviews, exact ${pct(diagnostics.exactHitRate)}, winnaar/gelijk ${pct(diagnostics.outcomeHitRate)}, top-5 exact ${pct(topConfidence.exactHitRate)}.`,
    topConfidence,
    topClubs,
    actions,
  };
}

function buildControlAgents(findings, proposal, digest) {
  const { latestDay, run } = latestMonitorRun(findings);
  const issues = run?.issues || [];
  const actions = issues.map((issue) => ({
    priority: issue.severity || "low",
    title: issue.message || issue.key,
    freeSolution: freeSolutionForIssue(issue.key),
    files: recommendedFiles(issue.key),
    status: "monitor",
  }));

  if (proposal?.shouldPropose) {
    actions.push({
      priority: "high",
      title: "Reviewbranch klaarzetten, niet blind live",
      freeSolution: `Maak ${proposal.branchName} alleen als patchvoorstel en merge pas na build + workercheck.`,
      files: proposal.recommendedFiles || [],
      status: "proposal",
    });
  }

  return {
    score: Math.max(0, 100 - actions.reduce((sum, item) => sum + severityScore(item.priority) * 8, 0)),
    summary: `Ontwikkelcontrole: ${issues.length} actieve monitorissues op ${latestDay || "onbekend"}; digest ${digest?.range?.from || "?"} t/m ${digest?.range?.to || "?"}.`,
    latestDay,
    shouldPropose: !!proposal?.shouldPropose,
    actions,
  };
}

function recommendedFiles(key) {
  const map = {
    today_matches_empty: ["scripts/server-worker.js", "api/Matches.ts"],
    h2h_empty: ["scripts/server-worker.js", "components/MatchCard.tsx"],
    bookmaker_signals_missing: ["scripts/server-worker.js", "components/MatchCard.tsx"],
    historical_referee_unmatched: ["scripts/server-worker.js"],
    standings_empty: ["scripts/server-worker.js", "components/StandingsView.tsx"],
    worker_stale: [".github/workflows/worker.yml"],
  };
  return map[key] || ["scripts/server-worker.js"];
}

function freeSolutionForIssue(key) {
  const map = {
    today_matches_empty: "Gebruik gratis fallbackketen met TheSportsDB/OpenLigaDB/openfootball en toon bronstatus in Instellingen.",
    h2h_empty: "Vul H2H uit openfootball/football-data competitiebestanden voordat de UI leeg toont.",
    bookmaker_signals_missing: "Gebruik gratis football-data odds-kolommen als per-bookmaker closing proxy.",
    historical_referee_unmatched: "Verbreed alias-cache met achternaam, initialen en competitie-families.",
    standings_empty: "Bouw standings opnieuw uit gespeelde uitslagen wanneer live standings ontbreken.",
    worker_stale: "Laat GitHub Actions schedule + manual dispatch draaien; geen mail nodig, alleen data committen.",
  };
  return map[key] || "Gebruik bestaande gratis workerdata en maak een reviewbranch-voorstel in plaats van blind live wijzigen.";
}

function buildRufloReport() {
  const store = readJsonSafe(DATA_FILE, {});
  const findings = readJsonSafe(FINDINGS_FILE, { days: {} });
  const proposal = readJsonSafe(PROPOSAL_FILE, null);
  const digest = readJsonSafe(DIGEST_FILE, null);
  const { run } = latestMonitorRun(findings);
  const resolvedKeys = resolvedActionKeys();

  const dataAgent = buildSourceAgents(store, run);
  const learningAgent = buildLearningAgents(store);
  const controlAgent = buildControlAgents(findings, proposal, digest);
  dataAgent.actions = filterResolvedActions(dataAgent.actions, resolvedKeys);
  learningAgent.actions = filterResolvedActions(learningAgent.actions, resolvedKeys);
  controlAgent.actions = filterResolvedActions(controlAgent.actions, resolvedKeys);
  const allActions = [
    ...dataAgent.actions.map((item) => ({ ...item, agent: "data" })),
    ...learningAgent.actions.map((item) => ({ ...item, agent: "learning" })),
    ...controlAgent.actions.map((item) => ({ ...item, agent: "control" })),
  ].sort((a, b) => severityScore(b.priority) - severityScore(a.priority));

  const topThemes = new Map();
  for (const action of allActions) {
    const key = issueKey(action.title);
    if (!topThemes.has(key)) topThemes.set(key, { title: action.title, count: 0, agents: new Set(), priority: action.priority });
    const item = topThemes.get(key);
    item.count += 1;
    item.agents.add(action.agent);
    if (severityScore(action.priority) > severityScore(item.priority)) item.priority = action.priority;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    date: amsterdamDate(),
    name: "Ruflo-style gratis AI monitor",
    mode: "naast-productie",
    productionSafe: true,
    summary: "Ruflo draait als extra agentlaag naast de app: hij leest monitor/data/reviews, zoekt gratis oplossingen en maakt patchadvies zonder blind live te wijzigen.",
    agents: {
      data: dataAgent,
      learning: learningAgent,
      control: controlAgent,
    },
    topThemes: [...topThemes.values()].map((item) => ({
      title: item.title,
      count: item.count,
      priority: item.priority,
      agents: [...item.agents],
    })).slice(0, 8),
    recommendedNextActions: allActions.slice(0, 10),
    freeOnlyGuardrails: [
      "Geen betaalde API key verplicht maken.",
      "Geen externe AI blind laten pushen naar productie.",
      "Scraping alleen via cache/snapshots en met fallback, zodat de app niet breekt bij rate limits.",
      "GitHub/Vercel meldingen blijven buiten de app; rapporten worden lokaal in monitor opgeslagen.",
    ],
  };

  const md = [
    "# Ruflo-style AI monitor",
    "",
    `Datum: ${report.date}`,
    "",
    report.summary,
    "",
    "## Agents",
    `- Data: ${dataAgent.summary}`,
    `- Leren: ${learningAgent.summary}`,
    `- Controle: ${controlAgent.summary}`,
    "",
    "## Gratis acties",
    ...report.recommendedNextActions.map((item, index) => `${index + 1}. [${item.priority}] ${item.title} (${item.agent}) - ${item.freeSolution}`),
    "",
    "## Guardrails",
    ...report.freeOnlyGuardrails.map((item) => `- ${item}`),
    "",
  ].join("\n");

  writeJson(OUTPUT_JSON, report);
  writeText(OUTPUT_MD, md);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

buildRufloReport();
