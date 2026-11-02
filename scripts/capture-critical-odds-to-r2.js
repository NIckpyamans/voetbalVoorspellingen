#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { buildR2ObjectKey, getR2Config, getR2Object, putR2Object } from "../shared/cloudflare-r2.js";
import { loadLocalEnv } from "../shared/database.js";
import { fetchOddsAtPrediction } from "./odds-provider.js";
import { findSportmonksFixture } from "./sportmonks-fixture-resolver.js";
import { sportmonksEligibleFixtures } from "./worker/sportmonks-coverage-policy.js";
import { classifyOddsCaptureRole, mergeOddsCaptureLedger, summarizeOddsCapture } from "./worker/critical-captures.js";
import { summarizeLeagueCoverage } from "./worker/coverage-summary.js";
import { prioritizeCaptureCandidates, summarizeCaptureWindows, applyCaptureBudget } from "./worker/capture-window-policy.js";
import { buildCentralQuotaPlan } from "./worker/quota-budget.js";
import { dedupeUpcomingMatches } from "./worker/odds-fixture-dedupe.js";
import { fetchOddspapiTournamentOdds, oddspapiApiKey } from "./providers/oddspapi-provider.js";
import { loadOddspapiUsage, oddspapiAllowance, oddspapiMonthId, saveOddspapiUsage } from "./worker/oddspapi-budget.js";
import { oddspapiOddsByMatch } from "./worker/oddspapi-fixture-map.js";

const ROOT = process.cwd();
const HOURS_AHEAD = Math.max(3, Number(process.env.CRITICAL_ODDS_HOURS_AHEAD || 36));
const LIMIT = Math.max(1, Number(process.env.CRITICAL_ODDS_MATCH_LIMIT || 40));
const OUTPUT = path.join(ROOT, "monitor", "critical-odds-capture.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function upcomingMatches() {
  const now = Date.now();
  const rows = [];
  for (let offset = 0; offset <= 2; offset += 1) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() + offset);
    const filePath = path.join(ROOT, "data", "days", `${day.toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(filePath)) continue;
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const match of Array.isArray(payload?.matches) ? payload.matches : []) {
      const kickoff = Date.parse(match?.kickoff || "");
      if (!Number.isFinite(kickoff) || kickoff <= now || kickoff > now + HOURS_AHEAD * 3600000) continue;
      if (!match?.homeTeamName || !match?.awayTeamName) continue;
      rows.push({
        matchId: String(match.id || `ss-${match.sofaId}`),
        kickoff: new Date(kickoff).toISOString(),
        league: match.league || null,
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
      });
    }
  }
  return dedupeUpcomingMatches(rows)
    .sort((left, right) => Date.parse(left.kickoff) - Date.parse(right.kickoff))
    .slice(0, LIMIT);
}

async function readLedger(config, key) {
  const object = await getR2Object({ config, key }).catch(() => null);
  if (!object?.ok) return null;
  return JSON.parse(object.body.toString("utf8"));
}

// OddsPapi dekt de Eerste Divisie waar The Odds API geen sportkey voor heeft. Eén
// odds-by-tournaments-call levert alle fixtures van de competitie tegelijk, dus we
// halen hem hooguit één keer per run op — en alleen als er nog een divisieduel
// zonder de juiste oddsrol openstaat. Zo blijft het verbruik ruim onder de 250
// requests van het gratis plan.
async function captureOddspapiFallback({ config, matches, report, readLedger }) {
  const divisieMatches = matches.filter((match) => /eerste\s*divisie/i.test(String(match?.league || "")));
  const state = { status: "skipped", candidates: divisieMatches.length };
  if (!divisieMatches.length) {
    state.reason = "geen eerste-divisie-duels in dit venster";
    report.oddspapi = state;
    return new Map();
  }
  const apiKey = oddspapiApiKey();
  if (!apiKey) {
    state.status = "missing_key";
    report.oddspapi = state;
    return new Map();
  }
  const pending = [];
  for (const match of divisieMatches) {
    const key = buildR2ObjectKey(config, `critical-captures/odds/${match.matchId}.json`);
    const ledger = await readLedger(config, key);
    const minutes = Math.round((Date.parse(match.kickoff) - Date.now()) / 60000);
    const role = classifyOddsCaptureRole(minutes);
    const existing = role === "closing" ? ledger?.closing : role === "prematch" ? ledger?.prematch : ledger?.opening;
    if (!existing) pending.push(match);
  }
  state.pending = pending.length;
  if (!pending.length) {
    state.status = "all_roles_captured";
    report.oddspapi = state;
    return new Map();
  }
  const month = oddspapiMonthId();
  const { usage } = await loadOddspapiUsage({ config, month });
  const allowance = oddspapiAllowance(usage);
  state.monthly = allowance;
  if (allowance.perRunCap <= 0) {
    state.status = "month_budget_exhausted";
    report.oddspapi = state;
    return new Map();
  }
  const configured = String(process.env.ODDSPAPI_BOOKMAKERS || "pinnacle,bet99,bpremium")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const bookmakers = (usage.preferredBookmaker ? [usage.preferredBookmaker] : configured).slice(0, allowance.perRunCap);
  const tournamentId = Number(process.env.ODDSPAPI_TOURNAMENT_ID || 131);
  const result = await fetchOddspapiTournamentOdds({
    apiKey,
    tournamentIds: [tournamentId],
    bookmakers,
    minIntervalMs: 1100,
  });
  const withQuotes = result.fixtures.filter((fixture) => fixture.quotes.length > 0);
  const byMatch = oddspapiOddsByMatch(result.fixtures, pending);
  const nextUsage = {
    ...usage,
    month,
    requests: allowance.used + result.requests,
    runs: Number(usage.runs || 0) + 1,
    // Onthoud de bookmaker die data gaf: daarna is één request per run genoeg en
    // hoeven we de bookmakerslijst niet elke keer opnieuw te proberen.
    preferredBookmaker: withQuotes.length ? withQuotes[0].quotes[0]?.bookmaker || bookmakers[0] || null : null,
  };
  const saved = await saveOddspapiUsage({ config, usage: nextUsage }).catch(() => nextUsage);
  report.oddspapi = {
    ...state,
    status: byMatch.size ? "captured" : "no_match",
    tournamentId,
    bookmakersTried: bookmakers,
    requests: result.requests,
    monthlyUsed: saved.requests,
    monthlyLimit: allowance.limit,
    monthlyRemaining: Math.max(0, allowance.limit - allowance.reserve - saved.requests),
    fixtures: result.fixtures.length,
    fixturesWithOdds: withQuotes.length,
    matchedMatches: byMatch.size,
    providerFailures: result.failures,
  };
  return byMatch;
}

async function main() {
  loadLocalEnv(ROOT);
  const config = getR2Config();
  if (!config.configured) throw new Error("Cloudflare R2 secrets ontbreken voor critical odds capture.");
  // Plan captures expliciet rond T-20/T-45/T-75 en respecteer het per-provider
  // quota-budget: zonder budget blijven alleen closing-captures over.
  const nowMs = Date.now();
  const candidates = prioritizeCaptureCandidates(upcomingMatches(), nowMs);
  const quotaPlan = buildCentralQuotaPlan(readJson(path.join(ROOT, "monitor", "provider-quota-audit.json"), {}) || {});
  const budgeted = applyCaptureBudget(candidates, quotaPlan, nowMs);
  const matches = budgeted.selected.slice(0, LIMIT);
  const duplicateFixturesMerged = candidates.reduce(
    (total, row) => total + (Array.isArray(row?.duplicateIds) ? row.duplicateIds.length : 0),
    0
  );
  const report = {
    generatedAt: new Date().toISOString(),
    checked: matches.length,
    duplicateFixturesMerged,
    captureWindows: summarizeCaptureWindows(candidates, nowMs),
    quotaBudget: {
      spendable: budgeted.spendable,
      skippedByBudget: budgeted.skippedByBudget.length,
      providers: Object.fromEntries(Object.entries(quotaPlan.providers || {}).map(([key, value]) => [key, { spendable: value?.spendable ?? 0, policy: value?.policy ?? "unknown" }])),
    },
    captured: 0,
    openingCaptured: 0,
    prematchCaptured: 0,
    closingCaptured: 0,
    closingPairs: 0,
    statuses: {},
    attemptStatuses: {},
    providerStatuses: {},
    providerQuota: {},
    skippedExistingRole: 0,
    sportmonksMapped: 0,
    sportmonksMappingStatuses: {},
    matches: [],
    oddspapi: null,
  };
  const oddspapiOdds = await captureOddspapiFallback({ config, matches, report, readLedger });
  const sportmonksCatalog = readJson(path.join(ROOT, "monitor", "sportmonks-catalog-sync.json"), {});
  for (const match of matches) {
    const sportmonks = sportmonksEligibleFixtures([match], sportmonksCatalog).length
      ? await findSportmonksFixture(match).catch((error) => ({ status: "resolver_error", error: error?.message || String(error) }))
      : { status: "plan_coverage_unavailable" };
    report.sportmonksMappingStatuses[sportmonks?.status || "unknown"] = Number(report.sportmonksMappingStatuses[sportmonks?.status || "unknown"] || 0) + 1;
    if (sportmonks?.fixtureId) report.sportmonksMapped += 1;
    const oddsMatch = { ...match, sportmonksFixtureId: sportmonks?.fixtureId || null };
    const minutesBeforeKickoff = Math.round((Date.parse(match.kickoff) - Date.now()) / 60000);
    const closingWindow = minutesBeforeKickoff >= 5 && minutesBeforeKickoff <= 30;
    const capturedAt = new Date().toISOString();
    const key = buildR2ObjectKey(config, `critical-captures/odds/${match.matchId}.json`);
    const existingLedger = await readLedger(config, key);
    const captureRole = classifyOddsCaptureRole(minutesBeforeKickoff);
    const existingRole = captureRole === "closing"
      ? existingLedger?.closing
      : captureRole === "prematch"
        ? existingLedger?.prematch
        : existingLedger?.opening;
    if (existingRole) {
      report.skippedExistingRole += 1;
      report.matches.push({ ...match, minutesBeforeKickoff, closingWindow, status: "already_captured", captureRole });
      continue;
    }
    const result = await fetchOddsAtPrediction(oddsMatch, {
      generatedAt: capturedAt,
      cutoffAt: capturedAt,
      // De normale reserve is juist bedoeld om T-20 closing captures over te houden.
      allowQuotaReserve: closingWindow,
    });
    report.statuses[result?.status || "unknown"] = Number(report.statuses[result?.status || "unknown"] || 0) + 1;
    for (const attempt of result?.requestMeta?.attempts || []) {
      const provider = attempt?.provider || "unknown";
      const status = attempt?.status || "unknown";
      const statusKey = `${provider}:${status}`;
      report.attemptStatuses[statusKey] = Number(report.attemptStatuses[statusKey] || 0) + 1;
      report.providerStatuses[provider] ||= {};
      report.providerStatuses[provider][status] = Number(report.providerStatuses[provider][status] || 0) + 1;
      if (attempt?.remaining != null) report.providerQuota[provider] = { remaining: Number(attempt.remaining) };
    }
    const quota = result?.requestMeta?.quota;
    if (quota && result?.provider) {
      report.providerQuota[result.provider] = {
        remaining: quota.remaining != null ? Number(quota.remaining) : null,
        used: quota.used != null ? Number(quota.used) : null,
        limit: quota.limit != null ? Number(quota.limit) : null,
        reset: quota.reset || null,
      };
    }
    const providerOdds = result?.oddsAtPrediction;
    const providerUsable = providerOdds && [providerOdds.home, providerOdds.draw, providerOdds.away].every((value) => Number(value) > 1);
    // The Odds API heeft geen sportkey voor de Eerste Divisie; OddsPapi levert die
    // odds in één call per run, hier als terugvaloptie.
    const divisieOdds = providerUsable ? null : oddspapiOdds.get(String(match.matchId));
    const odds = providerUsable
      ? providerOdds
      : divisieOdds
        ? { provider: "oddspapi", bookmaker: divisieOdds.bookmaker, market: "1X2", home: divisieOdds.home, draw: divisieOdds.draw, away: divisieOdds.away, capturedAt }
        : null;
    if (!odds) {
      report.matches.push({
        ...match,
        minutesBeforeKickoff,
        closingWindow,
        status: result?.status || "not_found",
        providerCompetitionAvailability: result?.requestMeta?.providerCompetitionAvailability || null,
        reason: result?.reason || null,
        sportmonksMapping: sportmonks?.status || "unknown",
      });
      continue;
    }
    const ledger = mergeOddsCaptureLedger(existingLedger, match, odds);
    await putR2Object({ config, key, body: `${JSON.stringify(ledger)}\n`, contentType: "application/json", metadata: { match: match.matchId, provider: odds.provider } });
    report.captured += 1;
    const latestRole = ledger.snapshots.at(-1)?.roleAtCapture;
    if (ledger.opening) report.openingCaptured += 1;
    if (ledger.prematch) report.prematchCaptured += 1;
    if (ledger.closing) report.closingCaptured += 1;
    if (ledger.opening && ledger.prematch && ledger.closing) report.closingPairs += 1;
    report.matches.push({ ...match, minutesBeforeKickoff, closingWindow, status: "captured", provider: odds.provider, captureRole: latestRole, sportmonksFixtureId: sportmonks?.fixtureId || null, oddspapiFixtureId: divisieOdds?.fixtureId || null, opening: Boolean(ledger.opening), prematch: Boolean(ledger.prematch), closing: Boolean(ledger.closing) });
  }
  // Dekking: opgeslagen rollen (already_captured) tellen mee als gedekt en de
  // werkelijk ontbrekende duels worden apart gerapporteerd, zodat een herhaalrun
  // de dekking niet ten onrechte naar 0% zakt.
  const coverageSummary = summarizeOddsCapture(report.matches);
  report.covered = coverageSummary.covered;
  report.alreadyCaptured = coverageSummary.alreadyCaptured;
  report.missing = coverageSummary.missing;
  report.missingMatches = coverageSummary.missingMatches;
  report.leagueCoverage = summarizeLeagueCoverage(report.matches, {
    success: (row) => row.status === "captured" || row.status === "already_captured",
  });
  report.coverage = coverageSummary.coverage;
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
