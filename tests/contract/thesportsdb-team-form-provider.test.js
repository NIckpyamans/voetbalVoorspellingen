import { describe, expect, it } from "vitest";
import {
  fetchTheSportsDbTeamForm,
  findTheSportsDbDirectResult,
  normalizeTheSportsDbRecentEvents,
} from "../../scripts/providers/thesportsdb-team-form-provider.js";

describe("TheSportsDB team form provider", () => {
  it("accepts only an exact alias and orients completed results to the requested club", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.includes("searchteams")) return { ok: true, json: async () => ({ teams: [{ idTeam: "1", strTeam: "Kairat Almaty" }] }) };
      return { ok: true, json: async () => ({ results: [{ idEvent: "e1", dateEvent: "2026-07-08", strHomeTeam: "Kairat Almaty", strAwayTeam: "Sutjeska", intHomeScore: "2", intAwayScore: "1" }] }) };
    };
    const data = await fetchTheSportsDbTeamForm({
      teamName: "Kairat",
      cache: {},
      nameVariants: () => ["Kairat", "Kairat Almaty"],
      fetchImpl,
      now: Date.parse("2026-07-20T00:00:00Z"),
    });
    expect(data.providerTeamId).toBe("1");
    expect(data.recentMatches).toMatchObject([{ opponent: "Sutjeska", score: "2-1", result: "W", venue: "H" }]);
    expect(calls).toHaveLength(2);
  });

  it("does not accept a different club with a similar name", () => {
    expect(normalizeTheSportsDbRecentEvents([{ strHomeTeam: "Kairat Almaty", strAwayTeam: "Sutjeska", intHomeScore: "2", intAwayScore: "1" }], "Kairat", "1")).toEqual([]);
  });

  it("rejects an exact team name from a different sport", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ teams: [{ idTeam: "volley-1", strTeam: "AS Cannes", strSport: "Volleyball" }] }),
    });
    const data = await fetchTheSportsDbTeamForm({
      teamName: "AS Cannes",
      cache: {},
      nameVariants: () => ["AS Cannes"],
      fetchImpl,
    });
    expect(data).toBeNull();
  });

  it("tries a safe alias query when the provider rejects punctuation in the club name", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.includes("searchteams.php?t=Ararat-Armenia")) return { ok: true, json: async () => ({ teams: [] }) };
      if (url.includes("searchteams")) return { ok: true, json: async () => ({ teams: [{ idTeam: "2", strTeam: "Ararat-Armenia" }] }) };
      return { ok: true, json: async () => ({ results: [] }) };
    };
    const data = await fetchTheSportsDbTeamForm({
      teamName: "Ararat-Armenia",
      cache: {},
      nameVariants: () => ["Ararat Armenia"],
      fetchImpl,
    });
    expect(data.providerTeamId).toBe("2");
    expect(calls).toHaveLength(3);
  });

  it("refreshes a partial recent-form cache before the full cache TTL expires", async () => {
    const now = Date.parse("2026-08-18T12:00:00Z");
    const calls = [];
    const cache = {
      ajax: {
        updatedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
        data: { providerTeamId: "old", recentMatches: [{ eventId: "old" }] },
      },
    };
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.includes("searchteams")) return { ok: true, json: async () => ({ teams: [{ idTeam: "1", strTeam: "Ajax" }] }) };
      return { ok: true, json: async () => ({ results: [] }) };
    };
    const data = await fetchTheSportsDbTeamForm({ teamName: "Ajax", cache, nameVariants: () => ["Ajax"], fetchImpl, now });
    expect(data.providerTeamId).toBe("1");
    expect(calls).toHaveLength(2);
  });

  it("keeps a complete ten-match cache for the normal TTL", async () => {
    const now = Date.parse("2026-08-18T12:00:00Z");
    const cached = { providerTeamId: "cached", recentMatches: Array.from({ length: 10 }, (_, index) => ({ eventId: String(index) })) };
    const fetchImpl = async () => {
      throw new Error("complete cache should avoid provider calls");
    };
    const data = await fetchTheSportsDbTeamForm({
      teamName: "Ajax",
      cache: { ajax: { updatedAt: now - 3 * 60 * 60 * 1000, data: cached } },
      nameVariants: () => ["Ajax"],
      fetchImpl,
      now,
    });
    expect(data).toBe(cached);
  });

  it("only exposes a direct completed fixture as H2H", () => {
    const direct = findTheSportsDbDirectResult(
      { recentMatches: [{ eventId: "e1", date: "2026-07-08", opponent: "Sutjeska", goalsFor: 2, goalsAgainst: 1, score: "2-1", providerTeamName: "Kairat Almaty" }] },
      null,
      "Kairat",
      "Sutjeska",
      (name) => (name === "Kairat" ? ["Kairat", "Kairat Almaty"] : [name])
    );
    expect(direct).toMatchObject({ home: "Kairat", away: "Sutjeska", score: "2-1", source: "thesportsdb-direct-fixture" });
    expect(findTheSportsDbDirectResult({ recentMatches: [{ opponent: "Different Club", score: "1-0" }] }, null, "Kairat", "Sutjeska", (name) => [name])).toBeNull();
  });
});
