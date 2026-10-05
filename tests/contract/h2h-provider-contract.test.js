import { describe, expect, it } from "vitest";
import { normalizeH2HProfile } from "../../scripts/providers/h2h-contract.js";

const match = {
  match_id: "fixture-1",
  home_club_id: "club-home",
  away_club_id: "club-away",
  home_team_name: "Ajax",
  away_team_name: "PSV",
  competition_id: "eredivisie",
  league: "Netherlands - Eredivisie",
  kickoff_at: "2026-10-10T18:00:00.000Z",
};

describe("normalized H2H provider contract", () => {
  it("normalizes reversed venue scores into current match orientation", () => {
    const profile = normalizeH2HProfile({
      source: "espn-team-schedule",
      results: [
        { id: "old-1", date: "2025-03-01", homeTeam: "PSV", awayTeam: "Ajax", homeScore: 2, awayScore: 3, league: "Netherlands - Eredivisie" },
      ],
    }, { match, provider: "espn-team-schedule", fetchedAt: "2026-10-01T00:00:00Z" });
    expect(profile).toMatchObject({ schemaVersion: "h2h-profile-v1", matchId: "fixture-1", played: 1, homeWins: 1, awayWins: 0, sameCompetitionPlayed: 1, publishable: true });
    expect(profile.results[0]).toMatchObject({ homeTeam: "PSV", awayTeam: "Ajax", score: "2-3", currentHomeIsHistoricalHome: false, currentHomeScore: 3, currentAwayScore: 2 });
    expect(profile.contentHash).toHaveLength(64);
  });

  it("quarantines mismatched teams, invalid scores, and post-kickoff results", () => {
    const profile = normalizeH2HProfile({ results: [
      { date: "2025-01-01", homeTeam: "Ajax", awayTeam: "Feyenoord", score: "1-0" },
      { date: "2025-02-01", homeTeam: "Ajax", awayTeam: "PSV", score: "x-y" },
      { date: "2026-10-11", homeTeam: "Ajax", awayTeam: "PSV", score: "1-0" },
    ] }, { match, provider: "test-provider" });
    expect(profile.played).toBe(0);
    expect(profile.publishable).toBe(false);
    expect(profile.quality.rejected).toEqual({ team_identity_mismatch: 1, invalid_score_or_date: 1, after_kickoff: 1 });
  });
});
