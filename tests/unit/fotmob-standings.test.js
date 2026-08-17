import { describe, expect, it, vi } from "vitest";
import {
  fetchFotmobStanding,
  fotmobSeasonFromDate,
  normalizeFotmobStanding,
  selectCurrentStandingCandidate,
} from "../../scripts/worker/fotmob-standings.js";

const response = {
  details: { id: 57 },
  fixtures: { allMatches: [{
    home: { name: "Ajax" },
    away: { name: "PSV" },
    status: { finished: true, utcTime: "2026-08-08T18:00:00Z" },
  }] },
  table: [{ data: { table: { all: [
    { idx: 1, id: 1, name: "Ajax", played: 2, wins: 2, draws: 0, losses: 0, scoresStr: "5-1", pts: 6 },
    { idx: 2, id: 2, name: "PSV", played: 2, wins: 1, draws: 0, losses: 1, scoresStr: "3-2", pts: 3 },
  ] } } }],
};

describe("FotMob standings adapter", () => {
  it("selects the European season around July", () => {
    expect(fotmobSeasonFromDate("2026-08-17")).toBe("2026/2027");
    expect(fotmobSeasonFromDate("2027-02-01")).toBe("2026/2027");
  });

  it("normalizes played matches, goals and points", () => {
    const standing = normalizeFotmobStanding(response, "Netherlands - Eredivisie", 57);
    expect(standing.source).toBe("fotmob");
    expect(standing.rows[0]).toMatchObject({ team: "Ajax", p: 2, w: 2, gf: 5, ga: 1, pts: 6 });
    expect(standing.resultKeys).toEqual(["2026-08-08|Ajax|PSV"]);
  });

  it("rejects a response from another competition", () => {
    expect(normalizeFotmobStanding(response, "Netherlands - Eerste Divisie", 111)).toBeNull();
  });

  it("uses the mapped league id and season", async () => {
    const fetchJson = vi.fn().mockResolvedValue(response);
    await fetchFotmobStanding("Netherlands - Eredivisie", "2026-08-17", fetchJson);
    expect(fetchJson.mock.calls[0][0]).toContain("id=57");
    expect(fetchJson.mock.calls[0][0]).toContain("season=2026%2F2027");
  });

  it("prefers a current table over a larger previous-season table", () => {
    const current = { source: "fotmob", rows: [{ p: 2 }] };
    const previous = { source: "football-data.co.uk", rows: [{ p: 34 }] };
    expect(selectCurrentStandingCandidate([previous, current], (item) => item.rows[0].p)).toBe(current);
  });
});
