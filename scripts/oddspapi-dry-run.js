#!/usr/bin/env node

// Droogrun voor OddsPapi: laat zien wat een meting van de Eerste Divisie aan
// requests kost en wat de geaggregeerde 1X2 wordt. Schrijft bewust niets weg —
// geen R2, geen database, geen capture-ledger.

import fs from "node:fs";
import path from "node:path";
import {
  ODDSPAPI_DEFAULT_BOOKMAKERS,
  ODDSPAPI_MIN_INTERVAL_MS,
  ODDSPAPI_SOCCER_SPORT_ID,
  aggregateOddspapiThreeWay,
  estimateOddspapiRequests,
  fetchOddspapi,
  fetchOddspapiTournamentOdds,
  oddspapiApiKey,
  oddspapiList,
  oddspapiTournamentId,
} from "./providers/oddspapi-provider.js";
import { buildQuotaBudget } from "./worker/quota-budget.js";
import { loadLocalEnv } from "../shared/database.js";

const ROOT = process.cwd();

// Zonder deze regel leest de droogrun alleen echte omgevingsvariabelen en niet de
// key uit .env, terwijl elk ander script in dit project dat wel doet.
loadLocalEnv(ROOT);

function readJson(relativePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const args = {};
  for (const item of argv.filter((entry) => entry.startsWith("--"))) {
    const [key, ...rest] = item.replace(/^--/, "").split("=");
    args[key] = rest.length ? rest.join("=") : "true";
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const apiKey = oddspapiApiKey();
const bookmakers = String(args.bookmakers || process.env.ODDSPAPI_BOOKMAKERS || ODDSPAPI_DEFAULT_BOOKMAKERS.join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const tournamentName = String(args.tournamentName || "Eerste Divisie");
const explicitTournamentId = Number(args.tournament || process.env.ODDSPAPI_TOURNAMENT_ID || 0) || null;
const sampleLimit = Math.max(1, Number(args.limit || 8));
const audit = readJson(path.join("monitor", "provider-quota-audit.json"), {}) || {};
const budget = buildQuotaBudget("oddspapi", audit.oddspapi || {}, { reserve: 10, perRun: 25 });
// Zolang de audit nog geen OddsPapi-cijfers heeft is spendable 0; de droogrun
// gebruikt dan een expliciete, lage bovengrens in plaats van stil te weigeren.
const dryRunCap = Math.max(1, Number(process.env.ODDSPAPI_DRYRUN_MAX_REQUESTS || 5));
const cap = budget.spendable > 0 ? budget.spendable : dryRunCap;
const plan = estimateOddspapiRequests({
  tournamentLookups: explicitTournamentId ? 0 : 1,
  bookmakers: bookmakers.length,
  tournaments: 1,
});

const report = {
  generatedAt: new Date().toISOString(),
  mode: "dry_run",
  writes: false,
  apiKeyConfigured: Boolean(apiKey),
  tournament: { name: tournamentName, id: explicitTournamentId },
  bookmakers,
  requests: { planned: plan, used: 0 },
  requestBudget: { cap, capSource: budget.spendable > 0 ? "quota_budget" : "dryrun_cap", policy: budget.policy },
  status: "pending",
};

function finish(status) {
  report.status = status;
  console.log(JSON.stringify(report, null, 2));
  process.exit(status === "ok" || status === "missing_key" ? 0 : 1);
}

if (!apiKey) {
  report.nextAction = `Zet ODDSPAPI_API_KEY in ${path.join(ROOT, ".env")} (regel: ODDSPAPI_API_KEY=<key>) of in je omgeving en draai dit script opnieuw.`;
  finish("missing_key");
}

if (plan.total > cap) {
  report.nextAction = `Deze meting kost ${plan.total} requests; de bovengrens is ${cap}. Verlaag het aantal bookmakers of verhoog ODDSPAPI_DRYRUN_MAX_REQUESTS.`;
  finish("quota_guard");
}

let tournamentId = explicitTournamentId;
if (!tournamentId) {
  const lookup = await fetchOddspapi({ path: "tournaments", params: { sportId: ODDSPAPI_SOCCER_SPORT_ID }, apiKey });
  report.requests.used += lookup.requests;
  const lookupList = oddspapiList(lookup.payload);
  if (!lookup.ok || !lookupList) {
    report.error = { stage: "tournaments", status: lookup.status };
    finish("tournament_lookup_failed");
  }
  tournamentId = oddspapiTournamentId(lookupList, tournamentName);
  if (!tournamentId) {
    report.availableTournaments = lookupList
      .slice(0, 40)
      .map((item) => item?.tournamentName || item?.name)
      .filter(Boolean);
    report.error = { stage: "tournaments", reason: "tournament_not_found" };
    finish("tournament_not_found");
  }
}
report.tournament.id = tournamentId;

const result = await fetchOddspapiTournamentOdds({
  apiKey,
  tournamentIds: [tournamentId],
  bookmakers,
  minIntervalMs: Number(process.env.ODDSPAPI_MIN_INTERVAL_MS || ODDSPAPI_MIN_INTERVAL_MS),
});
report.requests.used += result.requests;
report.providerFailures = result.failures;
report.fixturesFound = result.fixtures.length;
report.samples = result.fixtures
  .filter((fixture) => fixture.quotes.length > 0)
  .slice(0, sampleLimit)
  .map((fixture) => ({
    fixtureId: fixture.fixtureId,
    startTime: fixture.startTime,
    home: fixture.home,
    away: fixture.away,
    participant1Id: fixture.participant1Id,
    participant2Id: fixture.participant2Id,
    ...aggregateOddspapiThreeWay(fixture.quotes),
  }));
report.coveredFixtures = result.fixtures.filter((fixture) => fixture.quotes.length > 0).length;
if (!report.fixturesFound) {
  report.nextAction =
    "Geen fixtures gevonden. Controleer of je bookmakers in je OddsPapi-plan zitten (Availability -> Bookmakers Access op je accountpagina) en of het tournamentId klopt.";
}
finish("ok");
