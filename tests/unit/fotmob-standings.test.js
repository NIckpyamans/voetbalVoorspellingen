import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  FOTMOB_STANDINGS_LEAGUES,
  fetchFotmobStanding,
  fotmobSeasonFromDate,
  normalizeFotmobStanding,
  selectCurrentStandingCandidate,
} from "../../scripts/worker/fotmob-standings.js";
import { mergeCatalogStandings, sameTeam } from "../../shared/standingsCatalog.js";
import { isCompleteBalancedTable } from "../../shared/standingsIntegrity.js";

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
    const standing = normalizeFotmobStanding(response, "Netherlands - Eredivisie", 57, "2026/2027");
    expect(standing.source).toBe("fotmob");
    expect(standing.season).toBe("2026/2027");
    expect(standing.rows[0]).toMatchObject({ team: "Ajax", p: 2, w: 2, gf: 5, ga: 1, pts: 6 });
    expect(standing.resultKeys).toEqual(["2026-08-08|Ajax|PSV"]);
  });

  it("rejects a response from another competition", () => {
    expect(normalizeFotmobStanding(response, "Netherlands - Eerste Divisie", 111)).toBeNull();
  });

  it("maps UEFA league-phase standings and labels Conference League order as provisional", () => {
    const europeanPayload = {
      details: { id: 10216 },
      table: [{ data: { table: { all: [
        { idx: 2, id: 8593, name: "Ajax", played: 0, wins: 0, draws: 0, losses: 0, scoresStr: "0-0", pts: 0 },
        { idx: 1, id: 5, name: "AGF", played: 0, wins: 0, draws: 0, losses: 0, scoresStr: "0-0", pts: 0 },
      ] } } }],
    };
    const standing = normalizeFotmobStanding(europeanPayload, "Europe - Conference League", 10216, "2026/2027");
    expect(standing).toMatchObject({ source: "fotmob", preliminary: true });
    expect(standing.rows[0]).toMatchObject({ team: "Ajax", pos: 2, p: 0 });
  });

  it("normalizes and merges complete UEFA provider tables with alias spellings", () => {
    const catalog = JSON.parse(fs.readFileSync(new URL("../../config/competition-catalog.json", import.meta.url), "utf8"));
    const providerAliases = {
      "Bodo/Glimt": "Bodø/Glimt",
      Internazionale: "Inter",
      "Hapoel Be'er": "Hapoel Beer Sheva",
      "Jagiellonia Bialystok": "Jagiellonia Białystok",
      Lillestrom: "Lillestrøm",
    };
    const standings = {};
    for (const label of ["Europe - Champions League", "Europe - Europa League"]) {
      const competition = FOTMOB_STANDINGS_LEAGUES[label];
      const definition = catalog.competitions.find((item) => item.league === label);
      const rows = definition.teams.map((team, index) => ({
        idx: index + 1,
        id: index + 1,
        name: providerAliases[team] || team,
        played: 1,
        wins: index % 2 === 0 ? 1 : 0,
        draws: 0,
        losses: index % 2 === 0 ? 0 : 1,
        scoresStr: index % 2 === 0 ? "2-0" : "0-2",
        pts: index % 2 === 0 ? 3 : 0,
      }));
      const standing = normalizeFotmobStanding({
        details: { id: competition.id },
        table: [{ data: { table: { all: rows } } }],
      }, label, competition.id, "2026/2027");
      expect(isCompleteBalancedTable(standing.rows, definition.teams, sameTeam)).toBe(true);
      standings[`label:${label}`] = standing;
    }
    const merged = mergeCatalogStandings(standings, catalog);
    for (const label of ["Europe - Champions League", "Europe - Europa League"]) {
      const table = merged[`label:${label}`];
      expect(table.rows).toHaveLength(36);
      expect(table.rows.reduce((sum, row) => sum + row.p, 0)).toBe(36);
      expect(table.rows.reduce((sum, row) => sum + row.gf, 0)).toBe(table.rows.reduce((sum, row) => sum + row.ga, 0));
      expect(table.rows.every((row) => row.p === 1)).toBe(true);
      expect(table.source).toContain("fotmob");
    }
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
