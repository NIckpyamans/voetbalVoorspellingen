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

  it("matches canonical club aliases in both home-away orientations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "footyai-h2h-alias-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "data", "days"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "days", "2026-08-01.json"), JSON.stringify({
      matches: [{ date: "2026-08-01", league: "World - Club Friendlies", homeTeamName: "FC Barcelona", awayTeamName: "Manchester City FC", status: "FT", score: "2-1" }],
    }));
    const profile = readLocalH2HProfile(root, {
      kickoff_at: "2026-08-20T19:00:00Z",
      home_team_name: "Manchester City",
      away_team_name: "Barcelona",
    });
    expect(profile?.results).toMatchObject([{ homeTeam: "Manchester City FC", awayTeam: "FC Barcelona", homeScore: 1, awayScore: 2 }]);
  });

  it("matches Dutch reserve-team aliases used by different providers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "footyai-h2h-reserves-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "data", "days"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "days", "2026-02-02.json"), JSON.stringify({
      matches: [{ date: "2026-02-02", homeTeamName: "Ajax U21", awayTeamName: "PSV U21", status: "FT", score: "2-2" }],
    }));
    const profile = readLocalH2HProfile(root, {
      kickoff_at: "2026-08-31T18:00:00Z",
      home_team_name: "Jong PSV",
      away_team_name: "Jong Ajax",
    });
    expect(profile?.results).toMatchObject([{ homeScore: 2, awayScore: 2 }]);
  });
});
