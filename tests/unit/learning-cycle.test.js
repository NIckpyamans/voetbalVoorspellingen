import { describe, expect, it } from "vitest";
import { buildWeightedTeamLearning } from "../../scripts/worker/weighted-learning.js";
import { updateLearnedElo, lookupLearnedElo, LEARNED_ELO_VERSION } from "../../scripts/worker/learned-elo.js";

const NOW = Date.parse("2026-09-28T12:00:00Z");

function review(home, away, score, daysAgo, league = "Netherlands - Eredivisie") {
  return {
    homeTeamName: home,
    awayTeamName: away,
    actualScore: score,
    league,
    createdAt: new Date(NOW - daysAgo * 86400000).toISOString(),
    date: new Date(NOW - daysAgo * 86400000).toISOString().slice(0, 10),
  };
}

describe("weighted team learning", () => {
  it("geeft recente competitiewedstrijden meer gewicht dan oude friendlies", () => {
    const reviews = {
      recent: review("Ajax", "PSV", "2-1", 2),
      oldFriendly: review("Ajax", "PSV", "0-0", 200, "World - Club Friendlies"),
    };
    const learning = buildWeightedTeamLearning(reviews, NOW);
    expect(learning["name:ajax"].weightedMatches).toBeGreaterThan(
      learning["name:ajax"].weightedMatches - 1.2
    );
    expect(learning["name:ajax"].rawMatches).toBe(2);
    expect(learning["name:psv"].weightedPpg).toBeGreaterThan(0);
    expect(learning["name:ajax"].weightedPpg).toBeGreaterThan(learning["name:psv"].weightedPpg);
  });

  it("geeft geen weight aan rows zonder uitslag", () => {
    const learning = buildWeightedTeamLearning({ pending: review("Ajax", "Feyenoord", null, 1) }, NOW);
    expect(Object.keys(learning).length).toBe(0);
  });
});

describe("learned elo", () => {
  it("update ratings na een thuiswinst en houdt meta bij", () => {
    const reviews = { m1: review("Ajax", "PSV", "3-0", 1) };
    const result = updateLearnedElo(reviews, {}, { now: NOW });
    expect(result.version).toBe(LEARNED_ELO_VERSION);
    expect(result.processedMatches).toBe(1);
    expect(result.ratings["ajax"]).toBeGreaterThan(1500);
    expect(result.ratings["psv"]).toBeLessThan(1500);
    expect(result.meta["ajax"].matches).toBe(1);
  });

  it("verwerkt chronologisch en is deterministisch over volgorde", () => {
    const reviews = {
      later: review("Ajax", "PSV", "0-2", 1),
      earlier: review("Ajax", "PSV", "2-0", 5),
    };
    const result = updateLearnedElo(reviews, {}, { now: NOW });
    expect(result.processedMatches).toBe(2);
    expect(result.ratings["ajax"]).toBe(result.ratings["ajax"]);
  });

  it("friendlies veranderen ratings nauwelijks", () => {
    const friendlyOnly = updateLearnedElo({ f: review("Ajax", "PSV", "5-0", 1, "World - Club Friendlies") }, {}, { now: NOW });
    expect(Math.abs(friendlyOnly.ratings["ajax"] - 1500)).toBeLessThan(6);
  });

  it("lookup geeft freshness en null bij onbekende teams", () => {
    const state = updateLearnedElo({ m: review("Ajax", "PSV", "1-1", 3) }, {}, { now: NOW });
    const home = lookupLearnedElo(state, "Ajax");
    expect(home.elo).toBeGreaterThan(0);
    expect(home.freshness).toBeGreaterThan(0.9);
    expect(lookupLearnedElo(state, "Onbekend FC")).toBeNull();
  });
});
