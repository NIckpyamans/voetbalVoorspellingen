#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const FINDINGS_FILE = path.join(ROOT, "monitor", "daily-findings.json");
const OUTPUT_FILE = path.join(ROOT, "monitor", "review-branch-proposal.json");

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

function amsterdamDate(input = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(input);
}

function toBranchDate(dateString) {
  return dateString.replaceAll("-", "");
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function severityWeight(severity = "low") {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function recommendedFilesFor(key) {
  const map = {
    live_minute_missing: ["scripts/server-worker.js", "components/MatchCard.tsx", "components/LivePanel.tsx"],
    h2h_empty: ["scripts/server-worker.js", "components/MatchCard.tsx"],
    cupsheets_empty: ["scripts/server-worker.js", "components/StandingsView.tsx", "api/standings.ts"],
    standings_empty: ["scripts/server-worker.js", "api/standings.ts", "components/StandingsView.tsx"],
    dashboard_wrong_day: ["App.tsx", "services/matchService.ts", "api/Matches.ts"],
    duplicate_minute_logic: ["components/MatchCard.tsx", "components/LivePanel.tsx", "services/matchService.ts"],
    logo_fallback_missing: ["api/logo.ts", "components/MatchCard.tsx"],
    phase_reliability_empty: ["scripts/server-worker.js", "components/SettingsView.tsx", "types.ts"],
    bookmaker_signals_missing: ["scripts/server-worker.js", "components/MatchCard.tsx", "types.ts"],
    historical_referee_unmatched: ["scripts/server-worker.js", "components/MatchCard.tsx"],
    referee_alias_cache_missing: ["scripts/server-worker.js"],
    bookmaker_signal_logic_missing: ["scripts/server-worker.js", "components/MatchCard.tsx"],
    phase_buckets_missing: ["scripts/server-worker.js", "components/SettingsView.tsx", "types.ts"],
    worker_stale: [".github/workflows/worker.yml", "scripts/server-worker.js"],
    worker_last_run_missing: ["scripts/server-worker.js", "api/Matches.ts"],
    today_matches_empty: ["scripts/server-worker.js", "api/Matches.ts", "services/matchService.ts"],
    server_data_missing: ["scripts/server-worker.js", ".github/workflows/worker.yml"],
  };

  return map[key] || ["scripts/server-worker.js", "components/MatchCard.tsx"];
}

function explainIssue(key) {
  const map = {
    live_minute_missing: "Live minuten ontbreken in de feed of UI-fallback.",
    h2h_empty: "Onderlinge duels worden niet sterk genoeg gevuld.",
    cupsheets_empty: "Bekerschema of knock-out route wordt niet gevuld.",
    standings_empty: "Standentab mist brondata.",
    dashboard_wrong_day: "Speeldagfilter laat wedstrijden op de verkeerde datum zien.",
    duplicate_minute_logic: "Minute parsing staat nog dubbel en kan regressies geven.",
    logo_fallback_missing: "Clublogo fallback is niet stabiel genoeg.",
    phase_reliability_empty: "Fasebetrouwbaarheid wordt niet opgebouwd uit reviews.",
    bookmaker_signals_missing: "Bookmaker-specifieke closing-signalen ontbreken nog in wedstrijden.",
    historical_referee_unmatched: "Historische scheidsrechterdata matcht nog te weinig.",
    referee_alias_cache_missing: "Referee alias-cache kan breder per competitie/land.",
    bookmaker_signal_logic_missing: "Closing-lijnen per bookmaker worden niet voldoende benut.",
    phase_buckets_missing: "Reliability buckets missen fase-onderscheid.",
    worker_stale: "Workerdata is te oud en verdient een workflow- of broncheck.",
    worker_last_run_missing: "Worker slaat lastRun niet correct op.",
    today_matches_empty: "Vandaag-data ontbreekt terwijl er wedstrijden verwacht worden.",
    server_data_missing: "server_data.json ontbreekt of kan niet gelezen worden.",
  };

  return map[key] || "Gerichte patch nodig in worker en UI.";
}

function main() {
  const findings = readJsonSafe(FINDINGS_FILE, { days: {} });
  const date = amsterdamDate();
  const runs = findings.days?.[date]?.runs || [];
  const latestStats = runs.at(-1)?.stats || {};
  const flatIssues = uniqueBy(
    runs.flatMap((run) => run.issues || []),
    (issue) => `${issue.key}::${issue.message}`
  ).sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));

  const recommendedFiles = uniqueBy(
    flatIssues.flatMap((issue) => recommendedFilesFor(issue.key)),
    (value) => value
  );

  const proposal = {
    generatedAt: new Date().toISOString(),
    date,
    proposalOnly: true,
    shouldPropose: flatIssues.length > 0,
    branchName: `codex/review-${toBranchDate(date)}`,
    summary:
      flatIssues.length > 0
        ? `AI reviewvoorstel voor ${date}: ${flatIssues.length} aandachtspunt(en) met patchadvies, niet automatisch live.`
        : `Geen reviewbranch nodig op ${date}.`,
    latestStats,
    findings: flatIssues.map((issue, index) => ({
      priority: index + 1,
      key: issue.key,
      severity: issue.severity,
      message: issue.message,
      whyItMatters: explainIssue(issue.key),
      recommendedFiles: recommendedFilesFor(issue.key),
      details: issue.details || {},
    })),
    recommendedFiles,
    nextStep:
      flatIssues.length > 0
        ? "Gebruik deze proposal om gericht een reviewbranch te maken en alleen na controle te mergen."
        : "Geen actie nodig; monitor blijft op de achtergrond doorlopen.",
  };

  writeJson(OUTPUT_FILE, proposal);
  process.stdout.write(JSON.stringify(proposal, null, 2) + "\n");
}

main();
