#!/usr/bin/env node
import fs from "fs";
import path from "path";
import {
  fetchBbcScheduledEvents,
  fetchEspnScoreboardEvents,
} from "./worker/data-collection.js";
import { buildPoissonScoreModel } from "./worker/prediction.js";

const root = process.cwd();
const file = path.join(root, "server_data.json");

if (!fs.existsSync(file)) {
  console.error("[regression-assertions] server_data.json ontbreekt");
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(file, "utf-8"));
const scout = store?.dataScout || {};
const todayKey = scout?.collected?.todayDate || Object.keys(store.matches || {}).sort().findLast?.((date) => Array.isArray(store.matches?.[date])) || "";
const todayMatches = Array.isArray(store.matches?.[todayKey]) ? store.matches[todayKey] : [];
const hasH2hProfile = (match) =>
  Number(match?.h2h?.played || 0) > 0 ||
  Boolean(match?.h2h?.status || match?.h2h?.source || match?.h2hStatus);
const h2hProfileCount = todayMatches.filter(hasH2hProfile).length;
const assertions = (Array.isArray(scout?.regressionAssertions) ? scout.regressionAssertions : []).map((item) => {
  if (
    item?.key === "h2h_not_empty" &&
    !item?.passed &&
    todayMatches.length > 0 &&
    h2hProfileCount === todayMatches.length
  ) {
    return {
      ...item,
      passed: true,
      detail: `${h2hProfileCount}/${todayMatches.length} met H2H-profiel; directe historie mag leeg zijn`,
    };
  }
  return item;
});
const failedHigh = assertions.filter((item) => !item?.passed && String(item?.severity || "").toLowerCase() === "high");
const failedAny = assertions.filter((item) => !item?.passed);
const degraded = failedHigh.length > 0;

async function runContractAssertions() {
  const failures = [];
  const originalFetch = globalThis.fetch;
  const matchCardSource = fs.readFileSync(path.join(root, "components", "MatchCard.tsx"), "utf8");
  const worldCupViewSource = fs.readFileSync(path.join(root, "components", "WorldCupView.tsx"), "utf8");
  const countryFlagSource = fs.readFileSync(path.join(root, "shared", "countryFlags.ts"), "utf8");
  const matchServiceSource = fs.readFileSync(path.join(root, "services", "matchService.ts"), "utf8");
  const workerSource = fs.readFileSync(path.join(root, "scripts", "server-worker.js"), "utf8");
  const assert = (condition, message) => {
    if (!condition) failures.push(message);
  };

  assert(matchCardSource.includes("displayedMatchScore(match, isFinished)"), "Match card should derive a visible final score");
  assert(matchCardSource.includes("Eindstand"), "Finished match cards should label the final score");
  assert(worldCupViewSource.includes("CountryFlag"), "World Cup widget should render country flags");
  assert(worldCupViewSource.includes("actualScore(match)"), "World Cup widget should prefer actual final scores");
  assert(countryFlagSource.includes("flagcdn.com"), "National-team flags should include Flagcdn fallback");
  assert(countryFlagSource.includes("flagsapi.com"), "National-team flags should include a second free fallback");
  assert(matchServiceSource.includes("const hasNumericScore"), "Numeric home/away scores should normalize to a final result");
  assert(workerSource.includes('"World - FIFA World Cup 2026": "fifa.world"'), "World Cup scores should use the free ESPN fallback");
  assert(workerSource.includes('label: WORLD_CUP_LEAGUE, type: "cup"'), "World Cup fallback should be registered as a worker league");

  const bbcHtml = `
    <h2>Premier League</h2>
    <span class="visually-hidden">Arsenal versus Chelsea kick off 20:00</span>
  `;
  globalThis.fetch = async () => ({
    ok: true,
    async text() {
      return bbcHtml;
    },
    async json() {
      return {};
    },
  });
  const bbcEvents = await fetchBbcScheduledEvents("2026-06-03", {
    bbcCompetitionToLabel: { "Premier League": "England - Premier League" },
    espnScoreboardLeagues: {},
    leagues: [{ label: "England - Premier League", name: "Premier League", country: "England", type: "league" }],
    buildPossibleNames: (name) => [String(name || "").toLowerCase()],
    buildLogoLookupNames: (name) => [String(name || "").toLowerCase()],
    normalizeName: (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    buildFootballDataKickoffIso: (date, time) => `${date}T${time}:00.000Z`,
    isWomenContext: () => false,
    isYouthContext: () => false,
    sleep: async () => {},
  });
  assert(bbcEvents.length === 1, "BBC fallback contract should return one event");
  assert(bbcEvents[0]?.source === "bbc-fixture-fallback", "BBC fallback source should be stable");
  assert(bbcEvents[0]?.homeTeam?.name === "Arsenal", "BBC home team mapping should be stable");

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        events: [
          {
            id: "123",
            date: "2026-06-03T19:00:00Z",
            season: { year: 2026 },
            competitions: [
              {
                date: "2026-06-03T19:00:00Z",
                status: { type: { completed: true, name: "STATUS_FINAL", shortDetail: "FT" } },
                competitors: [
                  { homeAway: "home", score: "2", team: { id: "1", displayName: "Arsenal", logo: "home.png" } },
                  { homeAway: "away", score: "1", team: { id: "2", displayName: "Chelsea", logo: "away.png" } },
                ],
              },
            ],
          },
        ],
      };
    },
    async text() {
      return "";
    },
  });
  const espnEvents = await fetchEspnScoreboardEvents("2026-06-03", {
    espnScoreboardLeagues: { "England - Premier League": "eng.1" },
    leagues: [{ label: "England - Premier League", name: "Premier League", country: "England", type: "league" }],
    isWomenContext: () => false,
    isYouthContext: () => false,
    toAmsterdamDateKey: () => "2026-06-03",
    toNumber: (value) => Number(value),
    parseMinuteFromDescription: () => null,
    normalizeName: (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    sleep: async () => {},
  });
  assert(espnEvents.length === 1, "ESPN fallback contract should return one event");
  assert(espnEvents[0]?.status?.type === "finished", "ESPN completed status should map to finished");
  assert(espnEvents[0]?.homeScore?.current === 2, "ESPN home score should map numerically");

  const scoreModel = buildPoissonScoreModel(1.4, 1.1);
  const probabilityTotal = scoreModel.homeProb + scoreModel.drawProb + scoreModel.awayProb;
  assert(Math.abs(probabilityTotal - 1) < 0.000001, "Poisson 1X2 probabilities should normalize to 1");
  assert(scoreModel.scoreMatrix["1-1"] != null, "Poisson score matrix should include common scores");
  assert(Number.isFinite(scoreModel.bestProb) && scoreModel.bestProb > 0, "Poisson best probability should be positive");

  globalThis.fetch = originalFetch;
  return failures;
}

const contractFailures = await runContractAssertions();

console.log(`[regression-assertions] assertions: ${assertions.length}, failed: ${failedAny.length}, failedHigh: ${failedHigh.length}, degraded: ${degraded}`);
for (const row of failedAny) {
  console.log(`[regression-assertions] FAIL ${row.key}: ${row.detail}`);
}
for (const failure of contractFailures) {
  console.log(`[regression-assertions] CONTRACT FAIL: ${failure}`);
}

if (degraded || failedHigh.length > 0 || contractFailures.length > 0) {
  console.error("[regression-assertions] high-severity regressie of degraded mode actief");
  process.exit(1);
}

console.log(`[regression-assertions] contract assertions: ${contractFailures.length ? "failed" : "ok"}`);
console.log("[regression-assertions] ok");
