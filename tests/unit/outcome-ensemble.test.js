import { describe, expect, it } from "vitest";
import {
  buildEloOutcomeModel,
  buildOutcomeEnsemble,
  buildMarketConsensus,
  buildSquadStrengthOutcomeModel,
  buildTwoLegContextModel,
  devigThreeWayOdds,
  summarizeScoreCoverage,
} from "../../scripts/worker/outcome-ensemble.js";

describe("independent 1X2 outcome ensemble", () => {
  it("gives the stronger away squad an independent advantage", () => {
    const result = buildSquadStrengthOutcomeModel({ home_squad_rating: 57.1, away_squad_rating: 60.2 });
    expect(result.awayProb).toBeGreaterThan(result.homeProb);
  });

  it("treats a two-goal aggregate lead as a modest strategy signal", () => {
    const result = buildTwoLegContextModel({ aggregate_active: 1, aggregate_goal_diff: -2 });
    expect(result.awayProb).toBeGreaterThan(result.homeProb);
    expect(result.drawProb).toBeGreaterThan(0.3);
  });

  it("removes the bookmaker margin before using market probabilities", () => {
    const result = devigThreeWayOdds(
      { home: 2, draw: 3.5, away: 4, capturedAt: "2026-08-27T17:00:00Z" },
      "2026-08-27T19:00:00Z",
    );
    expect(result).not.toBeNull();
    expect(result.homeProb + result.drawProb + result.awayProb).toBeCloseTo(1, 3);
    expect(result.overround).toBeGreaterThan(1);
  });

  it("rejects odds captured after kickoff to prevent leakage", () => {
    expect(devigThreeWayOdds(
      { home: 2, draw: 3.5, away: 4, capturedAt: "2026-08-27T20:00:00Z" },
      "2026-08-27T19:00:00Z",
    )).toBeNull();
  });

  it("combines timestamped bookmaker offers and reports opening movement", () => {
    const result = buildMarketConsensus({
      capturedAt: "2026-08-27T18:00:00Z",
      openingHome: 2.2,
      openingDraw: 3.4,
      openingAway: 3.6,
      openingCapturedAt: "2026-08-26T18:00:00Z",
      bookmakers: [
        { bookmaker: "a", home: 2, draw: 3.5, away: 4 },
        { bookmaker: "b", home: 2.05, draw: 3.45, away: 3.9 },
      ],
    }, "2026-08-27T19:00:00Z");
    expect(result.bookmakers).toBe(2);
    expect(result.homeProb + result.drawProb + result.awayProb).toBeCloseTo(1, 3);
    expect(result.movement.home).toBeGreaterThan(0);
  });

  it("combines only available models and keeps unpromoted boosting inactive", () => {
    const result = buildOutcomeEnsemble({
      poisson: { homeProb: 0.5, drawProb: 0.28, awayProb: 0.22 },
      heuristic: { homeProb: 0.55, drawProb: 0.25, awayProb: 0.2 },
      monteCarlo: { homeProb: 0.52, drawProb: 0.27, awayProb: 0.21 },
      homeElo: 1700,
      awayElo: 1550,
    });
    expect(result.probabilities.homeProb).toBeGreaterThan(result.probabilities.awayProb);
    expect(result.components.find((item) => item.key === "gradient_boosting")).toMatchObject({ active: false });
    expect(result.probabilities.homeProb + result.probabilities.drawProb + result.probabilities.awayProb).toBeCloseTo(1, 3);
  });

  it("uses zero market weight and finite normalized probabilities without FA Cup odds", () => {
    const result = buildOutcomeEnsemble({
      poisson: { homeProb: 0.6, drawProb: 0.25, awayProb: 0.15 },
      heuristic: { homeProb: 0.5, drawProb: 0.3, awayProb: 0.2 },
      oddsAtPrediction: null,
    });
    expect(result.market).toBeNull();
    const market = result.components.find((c) => c.key === "de_vig_market");
    expect(market.active).toBe(false);
    expect(market.weight || 0).toBe(0);
    expect(Object.values(result.probabilities).every(Number.isFinite)).toBe(true);
    expect(Object.values(result.probabilities).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
  });

  it("houdt de herbalanceerde ensemblegewichten vast", () => {
    const result = buildOutcomeEnsemble({
      poisson: { homeProb: 0.45, drawProb: 0.3, awayProb: 0.25 },
      heuristic: { homeProb: 0.45, drawProb: 0.3, awayProb: 0.25 },
      monteCarlo: { homeProb: 0.45, drawProb: 0.3, awayProb: 0.25 },
      homeElo: 1700,
      awayElo: 1500,
      oddsAtPrediction: { home: 2, draw: 3.4, away: 4, capturedAt: "2026-08-27T17:00:00Z" },
      kickoff: "2026-08-27T19:00:00Z",
      featureVector: { home_squad_rating: 60, away_squad_rating: 55 },
    });
    const requested = Object.fromEntries(result.components.map((item) => [item.key, item.requestedWeight]));
    expect(requested).toEqual({
      dixon_coles_poisson: 0.37,
      feature_score_model: 0.22,
      monte_carlo: 0.14,
      club_elo: 0.05,
      de_vig_market: 0.16,
      confirmed_lineup: 0.05,
      squad_strength: 0.12,
      two_leg_context: 0.05,
      gradient_boosting: 0.2,
    });
    // De club-rating/Elo-heuristiek weegt lichter dan het doelpuntenmodel.
    expect(requested.club_elo).toBeLessThan(requested.dixon_coles_poisson);
    expect(result.version).toBe("outcome-ensemble-v4");
  });

  it("geeft een oudere marktquotering minder gewicht dan verse odds", () => {
    const base = {
      poisson: { homeProb: 0.5, drawProb: 0.28, awayProb: 0.22 },
      heuristic: { homeProb: 0.55, drawProb: 0.25, awayProb: 0.2 },
      kickoff: "2026-08-27T19:00:00Z",
    };
    const quote = { home: 1.7, draw: 3.8, away: 4.6 };
    const vers = buildOutcomeEnsemble({ ...base, oddsAtPrediction: { ...quote, capturedAt: "2026-08-27T17:00:00Z" } });
    const oud = buildOutcomeEnsemble({ ...base, oddsAtPrediction: { ...quote, capturedAt: "2026-08-25T17:00:00Z" } });
    expect(vers.market.freshness).toBe("fresh");
    expect(oud.market.freshness).toBe("stale");
    expect(oud.market.weightMultiplier).toBeLessThan(1);
    const weightOf = (result) => result.components.find((item) => item.key === "de_vig_market").requestedWeight;
    expect(weightOf(oud)).toBeLessThan(weightOf(vers));
    expect(Object.values(oud.probabilities).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 3);
  });

  it("reports honest top-3 and top-5 score coverage", () => {
    const coverage = summarizeScoreCoverage({ "1-0": 0.14, "1-1": 0.13, "2-0": 0.12, "2-1": 0.1, "0-0": 0.08 });
    expect(coverage.top1).toBe(0.14);
    expect(coverage.top3).toBe(0.39);
    expect(coverage.top5).toBe(0.57);
  });

  it("tempert de Elo-component voor interlands via club_elo_scale", () => {
    const strong = buildEloOutcomeModel(1900, 1500, { scale: 1 });
    const tempered = buildEloOutcomeModel(1900, 1500, { scale: 0.35 });
    expect(strong.homeProb - strong.awayProb).toBeGreaterThan(tempered.homeProb - tempered.awayProb);
  });

  it("trekt de kansen naar de marktconsensus wanneer de modellen het oneens zijn", () => {
    const inputs = {
      poisson: { homeProb: 0.8, drawProb: 0.1, awayProb: 0.1 },
      heuristic: { homeProb: 0.1, drawProb: 0.1, awayProb: 0.8 },
      monteCarlo: { homeProb: 0.1, drawProb: 0.15, awayProb: 0.75 },
      oddsAtPrediction: { home: 1.6, draw: 3.9, away: 5.5, capturedAt: "2026-08-27T17:00:00Z" },
      kickoff: "2026-08-27T19:00:00Z",
    };
    const result = buildOutcomeEnsemble(inputs);
    expect(result.agreement).toBeLessThan(0.55);
    expect(result.marketShrink).toBeGreaterThan(0);
    expect(result.marketShrink).toBeLessThanOrEqual(0.25);
    expect(
      result.probabilities.homeProb + result.probabilities.drawProb + result.probabilities.awayProb,
    ).toBeCloseTo(1, 3);
    const withoutMarket = buildOutcomeEnsemble({ ...inputs, oddsAtPrediction: null });
    expect(withoutMarket.marketShrink).toBe(0);
  });
});
