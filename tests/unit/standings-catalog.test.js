import { describe, expect, it } from "vitest";
import { mergeCatalogStandings } from "../../shared/standingsCatalog.js";

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
  it("keeps every catalog team when the live standing is partial", () => {
    const standings = mergeCatalogStandings({ partial: {
      label: "Netherlands - Eredivisie",
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
    } }, catalog);
    expect(standings["label:Netherlands - Eredivisie"].rows).toHaveLength(3);
    expect(standings["label:Netherlands - Eredivisie"].rows.some((row) => row.team === "Foreign Division Club")).toBe(false);
  });
});
