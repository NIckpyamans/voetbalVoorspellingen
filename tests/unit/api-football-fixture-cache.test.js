import { describe, expect, it } from "vitest";
import {
  emptyApiFootballFixtureCache,
  findCachedApiFootballFixtureId,
  mergeApiFootballFixtureMappings,
} from "../../scripts/worker/api-football-fixture-cache.js";

describe("API-Football fixture cache", () => {
  it("keeps accepted mappings available while Neon is unavailable", () => {
    const cache = mergeApiFootballFixtureMappings(emptyApiFootballFixtureCache(), [{
      id: "match-1",
      fixtureId: "98765",
      kickoff: "2026-08-14T19:00:00.000Z",
      league: "Europe - Europa League",
      homeTeam: "Ajax",
      awayTeam: "Opponent FC",
      confidence: 0.96,
    }], "2026-08-13T12:00:00.000Z");

    expect(cache).toMatchObject({ mapped: 1, total: 1 });
    expect(findCachedApiFootballFixtureId(cache, { match_id: "match-1" })).toBe("98765");
  });

  it("can recover a mapping by date and normalized team names", () => {
    const cache = mergeApiFootballFixtureMappings(emptyApiFootballFixtureCache(), [{
      id: "provider-independent-id",
      fixtureId: "123",
      kickoff: "2026-08-14T19:00:00.000Z",
      homeTeam: "Ajax FC",
      awayTeam: "The Opponent Club",
    }]);

    expect(findCachedApiFootballFixtureId(cache, {
      kickoff_at: "2026-08-14T19:00:00.000Z",
      home_team_name: "Ajax",
      away_team_name: "Opponent",
    })).toBe("123");
  });
});
