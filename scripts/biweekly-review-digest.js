#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const FINDINGS_FILE = path.join(ROOT, "monitor", "daily-findings.json");
const PROPOSAL_FILE = path.join(ROOT, "monitor", "review-branch-proposal.json");
const OUTPUT_JSON = path.join(ROOT, "monitor", "biweekly-review-digest.json");
const OUTPUT_MD = path.join(ROOT, "monitor", "biweekly-review-digest.md");

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
  };
  return map[key] || "Gebruik het reviewbranch-voorstel als veilige volgende patchronde.";
}

function buildDigest() {
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
  const digest = {
    generatedAt: new Date().toISOString(),
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
