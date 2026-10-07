import { describe, expect, it } from "vitest";
import { mergeCatalogStandings, sameTeam } from "../../shared/standingsCatalog.js";
import { validateStandingIntegrity } from "../../shared/standingsIntegrity.js";

const catalog = {
  season: "2026-2027",
  competitions: [{
    league: "Netherlands - Eredivisie",
    slug: "netherlands-eredivisie",
    expectedTeams: 3,
    format: "double_round_robin",
    membershipStatus: "provider_confirmed",
    teams: ["Ajax Amsterdam", "Heerenveen", "PSV Eindhoven"],
  }],
};

describe("standings catalog fallback", () => {
  it("allows played UEFA tables when participant membership remains provisional", () => {
    const result = validateStandingIntegrity("Europe - Champions League", {
      type: "cup",
      membershipStatus: "provisional_qualification_baseline",
      expectedTeams: 2,
    }, {
      season: "2026-2027",
      preliminary: false,
      rows: [
        { p: 1, w: 1, d: 0, l: 0, gf: 2, ga: 1, pts: 3 },
        { p: 1, w: 0, d: 0, l: 1, gf: 1, ga: 2, pts: 0 },
      ],
    }, "2026-2027");
    expect(result.errors).toEqual([]);
    expect(result.totalPlayed).toBe(2);
  });

  it("still rejects played tables explicitly marked as preliminary and retains goal checks", () => {
    const preliminary = validateStandingIntegrity("Europe - Conference League", {
      type: "cup",
      membershipStatus: "provisional_qualification_baseline",
      expectedTeams: 2,
    }, {
      season: "2026-2027",
      preliminary: true,
      rows: [
        { p: 1, w: 1, d: 0, l: 0, gf: 2, ga: 0, pts: 3 },
        { p: 1, w: 0, d: 0, l: 1, gf: 0, ga: 1, pts: 0 },
      ],
    }, "2026-2027");
    expect(preliminary.errors).toContain("Europe - Conference League: voorlopige UEFA league-phase bevat 1 gespeelde wedstrijden");

    const inconsistent = validateStandingIntegrity("Europe - Europa League", {
      type: "cup",
      expectedTeams: 2,
    }, {
      season: "2026-2027",
      preliminary: false,
      rows: [
        { p: 1, w: 1, d: 0, l: 0, gf: 3, ga: 0, pts: 3 },
        { p: 1, w: 0, d: 0, l: 1, gf: 0, ga: 1, pts: 0 },
      ],
    }, "2026-2027");
    expect(inconsistent.errors).toContain("Europe - Europa League: DV 3 verschilt van DT 1");
  });

  it("matches provider and catalog aliases for Hertha", () => {
    expect(sameTeam("Hertha BSC", "Hertha Berlin")).toBe(true);
  });
  it("matches Rennes to the Stade Rennais catalog name", () => {
    expect(sameTeam("Rennes", "Stade Rennais")).toBe(true);
  });
  it("matches German provider names to the English catalog aliases", () => {
    expect(sameTeam("Bayern Munchen", "Bayern Munich")).toBe(true);
    expect(sameTeam("1. FC Koln", "FC Cologne")).toBe(true);
    expect(sameTeam("Hamburger SV", "Hamburg SV")).toBe(true);
  });
  it("matches FotMob spelling variants for 2026 UEFA participants", () => {
    expect(sameTeam("Bodo/Glimt", "Bodø/Glimt")).toBe(true);
    expect(sameTeam("Internazionale", "Inter")).toBe(true);
    expect(sameTeam("Hapoel Be'er", "Hapoel Beer Sheva")).toBe(true);
    expect(sameTeam("Jagiellonia Bialystok", "Jagiellonia Białystok")).toBe(true);
    expect(sameTeam("Lillestrom", "Lillestrøm")).toBe(true);
    expect(sameTeam("Bodo/Glimt", "Borussia Dortmund")).toBe(false);
  });
  it("keeps UEFA provider statistics when team names use verified variants", () => {
    const europeanCatalog = {
      season: "2026-2027",
      competitions: [{
        league: "Europe - Europa League",
        slug: "europe-europa-league",
        type: "cup",
        expectedTeams: 3,
        format: "league_phase_8_matches_then_knockout",
        membershipStatus: "provisional_qualification_baseline",
        teams: ["Hapoel Be'er", "Jagiellonia Bialystok", "Lillestrom"],
      }],
    };
    const standings = mergeCatalogStandings({ "label:Europe - Europa League": {
      label: "Europe - Europa League",
      season: "2026/2027",
      source: "fotmob",
      rows: [
        { pos: 1, team: "Hapoel Beer Sheva", p: 2, w: 1, d: 1, l: 0, gf: 3, ga: 2, pts: 4 },
        { pos: 2, team: "Jagiellonia Białystok", p: 2, w: 1, d: 0, l: 1, gf: 2, ga: 2, pts: 3 },
        { pos: 3, team: "Lillestrøm", p: 2, w: 0, d: 1, l: 1, gf: 1, ga: 2, pts: 1 },
      ],
    } }, europeanCatalog);
    const table = standings["label:Europe - Europa League"];
    expect(table.rows.map((row) => row.p)).toEqual([2, 2, 2]);
    expect(table.rows.reduce((sum, row) => sum + row.gf, 0)).toBe(6);
    expect(table.rows.reduce((sum, row) => sum + row.ga, 0)).toBe(6);
  });
  it("keeps every catalog team when the live standing is partial", () => {
    const standings = mergeCatalogStandings({ partial: {
      label: "Netherlands - Eredivisie",
      season: "2026/2027",
      rows: [
        { team: "Ajax", p: 1, w: 0, d: 1, l: 0, gf: 1, ga: 1, pts: 1 },
        { team: "SC Heerenveen", p: 1, w: 0, d: 1, l: 0, gf: 1, ga: 1, pts: 1 },
      ],
      source: "live-match-overlay",
    } }, catalog);
    const rows = standings["label:Netherlands - Eredivisie"].rows;
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.team === "Ajax")).toMatchObject({ p: 1, gf: 1, ga: 1, pts: 1 });
    expect(rows.find((row) => row.team === "PSV Eindhoven")).toMatchObject({ p: 0, pts: 0 });
  });

  it("does not duplicate equivalent club names", () => {
    const standings = mergeCatalogStandings({ partial: {
      label: "Netherlands - Eredivisie",
      rows: [{ team: "PSV", p: 1, w: 1, gf: 2, ga: 0, pts: 3 }],
    } }, catalog);
    expect(standings["label:Netherlands - Eredivisie"].rows).toHaveLength(3);
  });

  it("rejects clubs that belong to another provider-confirmed competition", () => {
    const standings = mergeCatalogStandings({ polluted: {
      label: "Netherlands - Eredivisie",
      rows: [{ team: "Foreign Division Club", p: 1, w: 1, gf: 4, ga: 0, pts: 3 }],
      resultKeys: ["2026-08-20|foreign division club|another foreign club"],
      source: "live-match-overlay + live-match-overlay",
    } }, catalog);
    expect(standings["label:Netherlands - Eredivisie"].rows).toHaveLength(3);
    expect(standings["label:Netherlands - Eredivisie"].rows.some((row) => row.team === "Foreign Division Club")).toBe(false);
    expect(standings["label:Netherlands - Eredivisie"].resultKeys).toEqual([]);
    expect(standings["label:Netherlands - Eredivisie"].source).toBe("competition-catalog-zero + competition-catalog");
  });

  it("rebuilds points and goals from completed archived day matches", () => {
    const standings = mergeCatalogStandings({}, catalog, [{
      date: "2026-08-20",
      league: "Netherlands - Eredivisie",
      status: "FT",
      homeTeamName: "PSV",
      awayTeamName: "Ajax",
      score: "3-1",
    }]);
    const rows = standings["label:Netherlands - Eredivisie"].rows;
    expect(rows.find((row) => row.team === "PSV Eindhoven")).toMatchObject({ p: 1, w: 1, gf: 3, ga: 1, pts: 3 });
    expect(rows.find((row) => row.team === "Ajax Amsterdam")).toMatchObject({ p: 1, l: 1, gf: 1, ga: 3, pts: 0 });
  });

  it("does not apply archived results with a club outside the competition", () => {
    const standings = mergeCatalogStandings({}, catalog, [{
      date: "2026-08-20",
      league: "Netherlands - Eredivisie",
      status: "FT",
      homeTeamName: "PSV",
      awayTeamName: "Foreign Division Club",
      score: "3-1",
    }]);
    const rows = standings["label:Netherlands - Eredivisie"].rows;
    expect(rows.reduce((sum, row) => sum + row.p, 0)).toBe(0);
  });

  it("does not count a completed result twice when it is already in the standing", () => {
    const standings = mergeCatalogStandings({ partial: {
      label: "Netherlands - Eredivisie",
      season: "2026/2027",
      rows: [
        { team: "PSV", p: 1, w: 1, d: 0, l: 0, gf: 3, ga: 1, pts: 3 },
        { team: "Ajax", p: 1, w: 0, d: 0, l: 1, gf: 1, ga: 3, pts: 0 },
      ],
      resultKeys: ["2026-08-20|psv|ajax"],
    } }, catalog, [{
      date: "2026-08-20",
      league: "Netherlands - Eredivisie",
      status: "FT",
      homeTeamName: "PSV Eindhoven",
      awayTeamName: "Ajax Amsterdam",
      score: "3-1",
    }]);
    const rows = standings["label:Netherlands - Eredivisie"].rows;
    expect(rows.reduce((sum, row) => sum + row.p, 0)).toBe(2);
  });

  it("prefers the canonical current-season table over a stronger stale cache", () => {
    const standings = mergeCatalogStandings({
      stale: {
        label: "Netherlands - Eredivisie",
        rows: [{ team: "PSV", p: 34, w: 30, d: 2, l: 2, gf: 100, ga: 20, pts: 92 }],
        resultKeys: ["2026-05-10|PSV|Ajax"],
      },
      "label:Netherlands - Eredivisie": {
        label: "Netherlands - Eredivisie",
        season: "2026/2027",
        rows: [{ team: "PSV", p: 2, w: 2, d: 0, l: 0, gf: 7, ga: 1, pts: 6 }],
        resultKeys: ["2026-08-10|PSV|Ajax", "2026-08-17|PSV|Heerenveen"],
      },
    }, catalog);
    const psv = standings["label:Netherlands - Eredivisie"].rows.find((row) => row.team === "PSV");
    expect(psv).toMatchObject({ p: 2, pts: 6, gf: 7, ga: 1 });
  });

  it("rejects a played table without current-season evidence", () => {
    const standings = mergeCatalogStandings({ stale: {
      label: "Netherlands - Eredivisie",
      rows: [{ team: "PSV", p: 34, w: 30, d: 2, l: 2, gf: 100, ga: 20, pts: 92 }],
      source: "legacy-provider",
    } }, catalog);
    const rows = standings["label:Netherlands - Eredivisie"].rows;
    expect(rows.reduce((sum, row) => sum + row.p, 0)).toBe(0);
  });

  it("accepts actual provisional provider order for UEFA league phase without inventing results", () => {
    const uefaCatalog = {
      season: "2026-2027",
      competitions: [{
        league: "Europe - Conference League",
        slug: "europe-conference-league",
        type: "cup",
        expectedTeams: 3,
        format: "league_phase_8_matches_then_knockout",
        membershipStatus: "provisional_qualification_baseline",
        teams: ["Ajax", "AGF", "Roma"],
      }],
    };
    const standings = mergeCatalogStandings({ "label:Europe - Conference League": {
      label: "Europe - Conference League",
      season: "2026/2027",
      source: "fotmob",
      preliminary: true,
      rows: [
        { pos: 2, team: "Ajax", teamId: "fotmob-1", p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
        { pos: 1, team: "AGF", teamId: "fotmob-2", p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
        { pos: 3, team: "Roma", teamId: "fotmob-3", p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
      ],
    } }, uefaCatalog, [{
      date: "2026-10-01",
      league: "Europe - Conference League",
      status: "FT",
      homeTeamName: "Ajax",
      awayTeamName: "AGF",
      score: "4-0",
    }]);
    const table = standings["label:Europe - Conference League"];
    expect(table.preliminary).toBe(true);
    expect(table.rows.map((row) => row.pos)).toEqual([1, 2, 3]);
    expect(table.rows.find((row) => row.team === "Ajax")).toMatchObject({ pos: 2, p: 0, pts: 0 });
  });

  it("does not count UEFA qualifiers in a provisional league-phase table", () => {
    const uefaCatalog = {
      season: "2026-2027",
      competitions: [{
        league: "Europe - Europa League",
        slug: "europe-europa-league",
        type: "cup",
        expectedTeams: 2,
        format: "league_phase_8_matches_then_knockout",
        membershipStatus: "provisional_qualification_baseline",
        teams: ["Ajax", "PSV"],
      }],
    };
    const standings = mergeCatalogStandings({}, uefaCatalog, [{
      date: "2026-08-20",
      league: "Europe - Europa League",
      status: "FT",
      homeTeamName: "Ajax",
      awayTeamName: "PSV",
      score: "2-1",
    }]);
    expect(standings["label:Europe - Europa League"].rows.reduce((sum, row) => sum + row.p, 0)).toBe(0);
  });

  it("does not overlay archived matches on an authoritative provider table", () => {
    const standings = mergeCatalogStandings({
      "label:Netherlands - Eredivisie": {
        label: "Netherlands - Eredivisie",
        season: "2026/2027",
        source: "fotmob",
        rows: [
          { team: "PSV", p: 2, w: 2, d: 0, l: 0, gf: 5, ga: 1, pts: 6 },
          { team: "Ajax", p: 2, w: 1, d: 1, l: 0, gf: 3, ga: 2, pts: 4 },
        ],
        resultKeys: ["2026-08-10|psv|ajax", "2026-08-17|ajax|heerenveen"],
      },
    }, catalog, [{
      date: "2026-08-20",
      league: "Netherlands - Eredivisie",
      status: "FT",
      homeTeamName: "PSV Eindhoven",
      awayTeamName: "Heerenveen",
      score: "4-0",
    }]);

    const rows = standings["label:Netherlands - Eredivisie"].rows;
    expect(rows.find((row) => row.team === "PSV")).toMatchObject({ p: 2, pts: 6, gf: 5 });
    expect(standings["label:Netherlands - Eredivisie"].source).toContain("fotmob");
  });

  it("rejects incomplete UEFA provider tables instead of trusting their partial zeroed rows", () => {
    const uefaCatalog = {
      season: "2026-2027",
      competitions: [{
        league: "Europe - Champions League",
        slug: "europe-champions-league",
        type: "cup",
        expectedTeams: 3,
        format: "league_phase_8_matches_then_knockout",
        membershipStatus: "provisional_qualification_baseline",
        teams: ["Ajax", "PSV", "Roma"],
      }],
    };
    const standings = mergeCatalogStandings({ "label:Europe - Champions League": {
      label: "Europe - Champions League",
      season: "2026/2027",
      source: "fotmob",
      preliminary: false,
      rows: [
        { pos: 1, team: "Ajax", p: 1, w: 1, d: 0, l: 0, gf: 2, ga: 1, pts: 3 },
        { pos: 2, team: "PSV", p: 1, w: 0, d: 0, l: 1, gf: 1, ga: 2, pts: 0 },
        { pos: 3, team: "Wrong Club", p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
      ],
    } }, uefaCatalog);
    const table = standings["label:Europe - Champions League"];
    expect(table.rows.every((row) => row.p === 0)).toBe(true);
    expect(table.source).toBe("competition-catalog-zero + competition-catalog");
  });

  it("clears a stale UEFA league-phase table while membership is provisional", () => {
    const uefaCatalog = {
      season: "2026-2027",
      competitions: [{
        league: "Europe - Conference League",
        slug: "europe-conference-league",
        type: "cup",
        expectedTeams: 2,
        format: "league_phase_6_matches_then_knockout",
        membershipStatus: "provisional_qualification_baseline",
        teams: ["Ajax", "PSV"],
      }],
    };
    const standings = mergeCatalogStandings({ stale: {
      label: "Europe - Conference League",
      season: "2026/2027",
      source: "split-day-results",
      rows: [
        { team: "Ajax", p: 6, w: 5, d: 1, l: 0, gf: 12, ga: 3, pts: 16 },
        { team: "PSV", p: 6, w: 3, d: 1, l: 2, gf: 9, ga: 7, pts: 10 },
      ],
      lastResultDate: "2026-08-01",
    } }, uefaCatalog);

    expect(standings["label:Europe - Conference League"].rows.every((row) => row.p === 0)).toBe(true);
  });
});
