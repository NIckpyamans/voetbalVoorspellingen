import { describe, expect, it } from "vitest";
import { mergePhaseReliability } from "../../scripts/worker/phase-reliability-policy.js";

const profile = (matches, source = "immutable_training_fallback", reliabilityScore = 0.4) => ({
  matches,
  source,
  reliabilityScore,
});

describe("phase reliability policy", () => {
  it("preserves phases that are absent from a new aggregation", () => {
    const result = mergePhaseReliability(
      { qualification: profile(139), league: profile(64) },
      { league: profile(407, "local_post_match_reviews") },
      { lightweight: true }
    );
    expect(result.profiles.qualification.matches).toBe(139);
    expect(result.profiles.league.matches).toBe(64);
  });

  it("accepts a larger trusted replacement in a full evaluation", () => {
    const result = mergePhaseReliability(
      { league: profile(64) },
      { league: profile(249, "database_prediction_reviews", 0.5) }
    );
    expect(result.profiles.league.matches).toBe(249);
    expect(result.profiles.league.reliabilityScore).toBe(0.5);
  });

  it("rejects invalid and smaller profiles", () => {
    const result = mergePhaseReliability(
      { cup: profile(20) },
      { cup: profile(10), friendly: { matches: 0, reliabilityScore: 3 } }
    );
    expect(result.profiles.cup.matches).toBe(20);
    expect(result.profiles.friendly).toBeUndefined();
  });
});
