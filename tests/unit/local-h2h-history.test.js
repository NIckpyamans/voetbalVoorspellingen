import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { readLocalH2HProfile } from "../../scripts/worker/local-h2h-history.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("local H2H history", () => {
  it("uses a finished first leg and orients it to the upcoming home team", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "footyai-h2h-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "data", "days"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "days", "2026-08-12.json"), JSON.stringify({
      matches: [{ date: "2026-08-12", league: "Europe - Champions League", homeTeamName: "Bodø/Glimt", awayTeamName: "NEC Nijmegen", status: "FT", score: "2-0", dataSource: "fotmob" }],
    }));
    const profile = readLocalH2HProfile(root, {
      kickoff_at: "2026-08-19T19:00:00Z",
      home_team_name: "NEC Nijmegen",
      away_team_name: "Bodø/Glimt",
    });
    expect(profile).toMatchObject({
      source: "local immutable match history",
      results: [{ homeTeam: "NEC Nijmegen", awayTeam: "Bodø/Glimt", homeScore: 0, awayScore: 2 }],
    });
  });
});
