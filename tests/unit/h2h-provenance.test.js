import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findH2HProvenanceMismatches,
  normalizeMatchH2H,
  synchronizeMatchPredictionH2H,
} from "../../shared/h2hProvenance.js";
import { writeSplitDataFiles } from "../../scripts/worker/archive.js";

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("H2H provenance consistency", () => {
  it("normalizes conflicting nested and flat fields using the richer profile", () => {
    const match = normalizeMatchH2H({
      h2h: {
        played: 3,
        results: [{ score: "1-0" }, { score: "0-0" }, { score: "2-1" }],
        sameCompetitionPlayed: 2,
        status: "historical-competition",
        availabilityStatus: "available",
        source: "football-data.co.uk",
      },
      h2hStatus: "provider_acceptance_blocked",
      h2hAvailability: "provider_acceptance_blocked",
      h2hPlayed: 0,
    });

    expect(match).toMatchObject({
      h2hStatus: "historical-competition",
      h2hAvailability: "beschikbaar",
      h2hPlayed: 3,
      h2hCompetitionPlayed: 2,
      h2h: { status: "historical-competition", played: 3, sameCompetitionPlayed: 2 },
    });
  });

  it("detects prediction divergences and clears them when synchronized", () => {
    const match = normalizeMatchH2H({
      h2h: {
        played: 1,
        results: [{ score: "2-1" }],
        sameCompetitionPlayed: 1,
        status: "historical-competition",
        availabilityStatus: "available",
        source: "football-data.co.uk",
      },
    });
    const stalePrediction = {
      h2h: { played: 0, results: [], status: "provider_acceptance_blocked", availabilityStatus: "provider_acceptance_blocked" },
      h2hStatus: "provider_acceptance_blocked",
      h2hAvailability: "provider_acceptance_blocked",
      h2hPlayed: 0,
      h2hCompetitionPlayed: 0,
    };

    expect(findH2HProvenanceMismatches(match, stalePrediction)).toContain("h2hStatus");
    expect(findH2HProvenanceMismatches(match, synchronizeMatchPredictionH2H(match, stalePrediction))).toEqual([]);
  });

  it("publishes synchronized flat and nested provenance through static day exports", () => {
    const splitDataDir = mkdtempSync(path.join(os.tmpdir(), "h2h-static-export-"));
    tempDirectories.push(splitDataDir);
    const date = "2026-10-03";
    const match = normalizeMatchH2H({
      id: "fixture-export",
      date,
      h2h: {
        played: 2,
        results: [{ score: "1-0" }, { score: "2-2" }],
        sameCompetitionPlayed: 1,
        status: "historical-competition",
        availabilityStatus: "available",
        source: "football-data.co.uk",
        asOf: "2026-10-02T11:00:00.000Z",
      },
    });
    const stalePrediction = {
      matchId: match.id,
      h2h: { played: 0, results: [], status: "provider_acceptance_blocked" },
      h2hStatus: "provider_acceptance_blocked",
    };

    writeSplitDataFiles({ matches: { [date]: [match] }, predictions: { [date]: [stalePrediction] } }, {
      splitDataDir,
      retention: { nowMs: Date.parse("2026-10-03T12:00:00.000Z"), pastDays: 14, futureDays: 21 },
    });
    const day = JSON.parse(readFileSync(path.join(splitDataDir, "days", `${date}.json`), "utf8"));

    expect(findH2HProvenanceMismatches(day.matches[0], day.predictions[0])).toEqual([]);
    expect(day.predictions[0]).toMatchObject({
      h2hStatus: "historical-competition",
      h2hAvailability: "beschikbaar",
      h2hPlayed: 2,
      h2hCompetitionPlayed: 1,
      h2h: { status: "historical-competition", played: 2, sameCompetitionPlayed: 1 },
    });
  });
});
