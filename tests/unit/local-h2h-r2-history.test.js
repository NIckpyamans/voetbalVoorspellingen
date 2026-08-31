import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { readLocalH2HProfile } from "../../scripts/worker/local-h2h-history.js";

describe("local H2H immutable ledger", () => {
  it("uses an R2 snapshot evaluation when static history is empty", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "h2h-ledger-"));
    fs.mkdirSync(path.join(root, "data", "days"), { recursive: true });
    const ledger = {
      predictionSnapshots: { p1: { matchId: "old", date: "2026-08-01", kickoff: "2026-08-01T20:00:00Z", homeTeam: "Jong Ajax", awayTeam: "Jong PSV", league: "Netherlands - Eerste Divisie" } },
      evaluations: { p1: { finalHomeGoals: 2, finalAwayGoals: 1, evaluationSource: "r2" } },
    };
    const profile = readLocalH2HProfile(root, { home_team_name: "Ajax U21", away_team_name: "PSV U21", kickoff_at: "2026-09-01T20:00:00Z" }, 5, { ledger });
    expect(profile).toMatchObject({ played: 1, source: "local immutable R2 match history" });
    expect(profile.results[0]).toMatchObject({ homeScore: 2, awayScore: 1 });
  });
});
