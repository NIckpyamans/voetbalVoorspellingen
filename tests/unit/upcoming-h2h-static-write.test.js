import { describe, expect, it } from "vitest";
import { normalizeStaticH2H } from "../../scripts/worker/h2h-static.js";

describe("upcoming H2H static profile", () => {
  it("normalizes provider scores and current-team winners", () => {
    const match = {
      home_club_id: "fotmob-9879",
      away_club_id: "fotmob-8455",
      home_team_name: "Fulham",
      away_team_name: "Chelsea",
      league: "England - Premier League",
      kickoff_at: "2026-08-20T19:00:00Z",
    };
    const profile = {
      source: "football-data.co.uk",
      results: [
        { date: "2025-04-20", homeTeam: "Fulham", awayTeam: "Chelsea", homeScore: 1, awayScore: 2, league: "England - Premier League" },
        { date: "2025-12-01", homeTeam: "Chelsea", awayTeam: "Fulham", homeScore: 0, awayScore: 0, league: "England - Premier League" },
      ],
    };
    const result = normalizeStaticH2H(match, profile);
    expect(result).toMatchObject({ played: 2, homeWins: 0, draws: 1, awayWins: 1, sameCompetitionPlayed: 2 });
    expect(result.results[0]).toMatchObject({ score: "1-2", winnerId: "fotmob-8455" });
    expect(result.results[1]).toMatchObject({ score: "0-0", winnerId: "" });
  });

  it("matches canonical aliases and resolves winners for reversed historical venues", () => {
    const match = {
      home_club_id: "nec-current",
      away_club_id: "other-current",
      home_team_name: "N.E.C. Nijmegen",
      away_team_name: "Opponent FC",
      kickoff_at: "2026-08-20T19:00:00Z",
    };
    const profile = {
      source: "fixture-import",
      results: [{
        date: "2025-03-12",
        homeTeam: { id: "other-current", name: "Opponent" },
        awayTeam: { id: "nec-current", name: "NEC" },
        homeScore: 1,
        awayScore: 3,
        league: "Other Cup",
      }],
    };
    const result = normalizeStaticH2H(match, profile);
    expect(result).toMatchObject({ played: 1, homeWins: 1, awayWins: 0, sameCompetitionPlayed: 0 });
    expect(result.results[0]).toMatchObject({ score: "1-3", winnerId: "nec-current", home: "Opponent", away: "NEC" });
  });

  it("rejects unrelated teams, missing dates, and post-kickoff history", () => {
    const match = {
      home_club_id: "home-id",
      away_club_id: "away-id",
      home_team_name: "Home",
      away_team_name: "Away",
      kickoff_at: "2026-08-20T19:00:00Z",
    };
    const result = normalizeStaticH2H(match, {
      results: [
        { date: "2025-01-01", home: "Home", away: "Unrelated", score: "1-0" },
        { date: "2026-08-20", home: "Home", away: "Away", score: "2-0" },
        { home: "Home", away: "Away", score: "2-0" },
      ],
    });
    expect(result).toBeNull();
  });
});
