import { beforeEach, describe, expect, it } from "vitest";
import {
  fetchFootballDataCoUkH2HProfile,
  parseFootballDataCsv,
  resetFootballDataH2HCacheForTests,
} from "../../scripts/providers/football-data-co-uk-h2h-provider.js";

beforeEach(() => resetFootballDataH2HCacheForTests());

describe("football-data.co.uk H2H provider", () => {
  it("parses quoted CSV fields", () => {
    expect(parseFootballDataCsv('Date,HomeTeam,AwayTeam,FTHG,FTAG\n20/04/2025,"Fulham, FC",Chelsea,1,2')[0])
      .toMatchObject({ HomeTeam: "Fulham, FC", AwayTeam: "Chelsea", FTHG: "1", FTAG: "2" });
  });

  it("returns up to five completed meetings in either orientation", async () => {
    const csv = [
      "Date,HomeTeam,AwayTeam,FTHG,FTAG",
      "13/01/2023,Fulham,Chelsea,2,1",
      "03/02/2023,Chelsea,Fulham,0,0",
      "02/10/2023,Fulham,Chelsea,0,2",
      "13/01/2024,Chelsea,Fulham,1,0",
      "20/04/2025,Fulham,Chelsea,1,2",
      "30/08/2025,Chelsea,Fulham,2,0",
      "24/08/2026,Fulham,Chelsea,9,9",
    ].join("\n");
    const profile = await fetchFootballDataCoUkH2HProfile({
      league: "England - Premier League",
      kickoff_at: "2026-08-24T19:00:00Z",
      home_team_name: "Fulham",
      away_team_name: "Chelsea",
    }, { fetchImpl: async () => new Response(csv, { status: 200 }) });

    expect(profile.source).toContain("football-data.co.uk");
    expect(profile.results).toHaveLength(5);
    expect(profile.results.at(-1)).toMatchObject({ homeTeam: "Chelsea", awayTeam: "Fulham", homeScore: 2, awayScore: 0 });
    expect(profile.results.some((result) => result.homeScore === 9)).toBe(false);
  });

  it("does not claim coverage for unsupported competitions", async () => {
    const profile = await fetchFootballDataCoUkH2HProfile({ league: "Europe - Champions League" });
    expect(profile).toBeNull();
  });
});
