import { describe, expect, it } from "vitest";
import { buildStandingsLookup, findStandingEntry, findStandingPosition } from "../../shared/standingsLookup.js";

const lookup = buildStandingsLookup({
  "label:Netherlands - Eerste Divisie": {
    label: "Netherlands - Eerste Divisie",
    rows: [
      { team: "Heracles", teamId: "fotmob-9791", pos: 1 },
      { team: "MVV Maastricht", teamId: "fotmob-9838", pos: 3 },
      { team: "TOP Oss", teamId: "fotmob-7781", pos: 20 },
    ],
  },
  "label:Europe - Europa League": {
    label: "Europe - Europa League",
    rows: [{ team: "TOP Oss", teamId: "catalog:uefa:top-oss", pos: 31 }],
  },
  "label:Europe - Conference League": {
    label: "Europe - Conference League",
    preliminary: true,
    rows: [{ team: "Ajax", teamId: "fotmob-8593", pos: 2 }],
  },
});

describe("standings lookup for dashboard fixture rows", () => {
  it("finds rank by exact provider team ID within the correct league", () => {
    expect(findStandingPosition(lookup, {
      teamId: "fotmob-7781",
      teamName: "TOP Oss",
      league: "Netherlands - Eerste Divisie",
    })).toBe(20);
  });

  it("finds rank by team name when fixture provider IDs differ", () => {
    expect(findStandingPosition(lookup, {
      teamId: "other-provider-123",
      teamName: "MVV",
      league: "Netherlands - Eerste Divisie",
    })).toBe(3);
  });

  it("returns provisional status only from the exact competition table", () => {
    expect(findStandingEntry(lookup, {
      teamId: "fotmob-8593",
      teamName: "Ajax",
      league: "Europe - Conference League",
    })).toEqual({ position: 2, preliminary: true });
    expect(findStandingEntry(lookup, {
      teamId: "fotmob-8593",
      teamName: "Ajax",
      league: "Netherlands - Eerste Divisie",
    })).toBeNull();
  });

  it("does not leak a same-named rank from another competition", () => {
    expect(findStandingPosition(lookup, {
      teamId: "missing-id",
      teamName: "TOP Oss",
      league: "Netherlands - Eerste Divisie",
    })).toBe(20);
  });
});
