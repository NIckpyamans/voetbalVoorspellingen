import { describe, expect, it } from "vitest";
import { normalizeStaticH2H } from "../../scripts/worker/h2h-static.js";

describe("upcoming H2H static profile", () => {
  it("normalizes provider scores and current-team winners", () => {
    const match = {
      home_club_id: "fotmob-9879",
      away_club_id: "fotmob-8455",
      home_team_name: "Fulham",
      away_team_name: "Chelsea",
    };
    const profile = {
      source: "football-data.co.uk",
      results: [
        { date: "2025-04-20", homeTeam: "Fulham", awayTeam: "Chelsea", homeScore: 1, awayScore: 2 },
        { date: "2025-12-01", homeTeam: "Chelsea", awayTeam: "Fulham", homeScore: 0, awayScore: 0 },
      ],
    };
    const result = normalizeStaticH2H(match, profile);
    expect(result).toMatchObject({ played: 2, homeWins: 0, draws: 1, awayWins: 1 });
    expect(result.results[0]).toMatchObject({ score: "1-2", winnerId: "fotmob-8455" });
  });
});
