import { describe, expect, it } from "vitest";
import { fetchFotMobTeamForm, normalizeFotMobTeamFixtures } from "../../scripts/providers/fotmob-team-form-provider.js";

const finished = {
  id: 123,
  home: { id: 8464, name: "NEC Nijmegen", score: 1 },
  away: { id: 8402, name: "Bodø/Glimt", score: 3 },
  tournament: { name: "Champions League" },
  status: { utcTime: "2026-08-19T19:00:00Z", finished: true },
};

describe("FotMob team form provider", () => {
  it("orients completed fixtures to the requested club", () => {
    expect(normalizeFotMobTeamFixtures([finished], "8402", "Bodø/Glimt", Date.parse("2026-08-20T00:00:00Z")))
      .toMatchObject([{ venue: "A", opponent: "NEC Nijmegen", score: "3-1", result: "W" }]);
  });

  it("ignores future and unfinished fixtures", () => {
    expect(normalizeFotMobTeamFixtures([{ ...finished, status: { ...finished.status, finished: false } }], "8402", "Bodø/Glimt"))
      .toHaveLength(0);
  });

  it("loads the public team fixture contract", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      details: { name: "Bodø/Glimt" },
      fixtures: { allFixtures: { fixtures: [finished] } },
    }), { status: 200 });
    const profile = await fetchFotMobTeamForm({
      teamId: "fotmob-8402",
      teamName: "Bodø/Glimt",
      now: Date.parse("2026-08-20T00:00:00Z"),
      fetchImpl,
    });
    expect(profile).toMatchObject({ providerTeamId: "8402", source: "fotmob-team-fixtures" });
    expect(profile.recentMatches).toHaveLength(1);
  });
});
