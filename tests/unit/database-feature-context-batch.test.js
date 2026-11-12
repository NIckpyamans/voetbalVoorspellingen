import { describe, expect, it, vi } from "vitest";
import { readDatabaseFeatureContextBatch } from "../../shared/databaseFeatureContextBatch.js";

function fakeSql(rowsByMarker) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sqlText) => {
      const marker = String(sqlText).match(/\/\* dfb:([a-z-]+) \*\//)?.[1] || "onbekend";
      calls.push({ marker });
      return rowsByMarker[marker] || [];
    }),
  };
}

const matchRow = {
  match_id: "ss-1",
  date_key: "2026-11-14",
  home_club_id: "10",
  away_club_id: "20",
  home_name: "ajax",
  away_name: "psv eindhoven",
};

const requests = [
  {
    matchId: "ss-1",
    homeClubId: "10",
    awayClubId: "20",
    competitionId: null,
    dateKey: "2026-11-14",
    homeTeamName: "Ajax",
    awayTeamName: "PSV Eindhoven",
  },
  {
    matchId: "ss-2",
    homeClubId: null,
    awayClubId: null,
    competitionId: null,
    dateKey: "2026-11-14",
    homeTeamName: "Onbekend",
    awayTeamName: "PSV Eindhoven",
  },
];

describe("readDatabaseFeatureContextBatch", () => {
  it("doet één query per lookupsoort voor het hele venster", async () => {
    const sql = fakeSql({
      "club-ids": [{ club_id: "10" }, { club_id: "20" }],
      matches: [matchRow],
    });
    await readDatabaseFeatureContextBatch(requests, { sql });
    const markers = sql.calls.map((call) => call.marker);
    for (const marker of ["club-ids", "club-aliases", "club-names", "matches", "bundles", "season", "h2h"]) {
      expect(markers.filter((entry) => entry === marker)).toHaveLength(1);
    }
  });

  it("lost clubs en fixtures op in dezelfde prioriteit als de enkelvoudige variant", async () => {
    const sql = fakeSql({
      "club-ids": [{ club_id: "10" }, { club_id: "20" }],
      "club-aliases": [{ normalized_alias: "psv-eindhoven", club_id: "20" }],
      "club-names": [{ club_id: "30", name: "Onbekend" }],
      matches: [matchRow],
    });

    const contexts = await readDatabaseFeatureContextBatch(requests, { sql });
    const first = contexts.get("ss-1");
    const second = contexts.get("ss-2");

    expect(first.matchResolution).toEqual({ matchId: "ss-1", source: "provided_match_id" });
    expect(first.homeResolution).toEqual({ clubId: "10", source: "provided_id" });
    expect(first.awayResolution).toEqual({ clubId: "20", source: "provided_id" });
    expect(first.aliasMatched).toBe(false);

    expect(second.homeResolution.source).toBe("club_name");
    expect(second.homeResolution.clubId).toBe("30");
    expect(second.awayResolution.source).toBe("club_aliases");
    expect(second.awayResolution.clubId).toBe("20");
    expect(second.matchResolution).toEqual({ matchId: null, source: "unresolved" });
    expect(second.matchStats).toEqual({});
    expect(second.lineupSummary).toBeNull();
    expect(second.h2hEdge).toBeNull();
    expect(second.featureSources).toEqual([]);
  });

  it("bouwt het feature-bundel en de seizoens-/H2H-bronnen om tot dezelfde vorm", async () => {
    const sql = fakeSql({
      "club-ids": [{ club_id: "10" }, { club_id: "20" }],
      matches: [matchRow],
      bundles: [
        {
          match_id: "ss-1",
          weather_payload: { conditions: "Clear", temperature: 12 },
          match_stats_row: {
            home_xg: 1.4,
            away_xg: 0.9,
            home_shots: 12,
            away_shots: 7,
            home_corners: 5,
            away_corners: 3,
            stats_source: "provider-a",
          },
          team_match_stats_payload: [{ side: "home" }, { side: "away" }],
          historical_odds_payload: { samples: 4, closingSamples: 2 },
          lineup_payload: {
            provider: "provider-a",
            capturedAt: "2026-11-14T12:00:00.000Z",
            lineupSummary: { confirmed: true },
          },
        },
      ],
      season: [
        {
          club_id: "10",
          style_profile: { pressing: 0.6 },
          xg_for: 1.8,
          xg_against: 1.1,
          matches_played: 12,
          updated_at: "2026-11-10T00:00:00.000Z",
        },
        {
          club_id: "20",
          style_profile: {},
          xg_for: 1.2,
          xg_against: 1.4,
          matches_played: 11,
          updated_at: "2026-11-09T00:00:00.000Z",
        },
      ],
      h2h: [
        {
          home_club_id: "10",
          away_club_id: "20",
          played: 27,
          competition_id: null,
          updated_at: "2026-11-01T00:00:00.000Z",
        },
      ],
    });

    const contexts = await readDatabaseFeatureContextBatch([requests[0]], { sql });
    const context = contexts.get("ss-1");

    expect(context.matchStats).toEqual({
      homeXg: 1.4,
      awayXg: 0.9,
      homeShots: 12,
      awayShots: 7,
      homeCorners: 5,
      awayCorners: 3,
      statsSource: "provider-a",
    });
    expect(context.teamMatchStats).toHaveLength(2);
    expect(context.historicalOdds).toEqual({ samples: 4, closingSamples: 2 });
    expect(context.weather).toEqual({ conditions: "Clear", temperature: 12 });
    expect(context.teamSeasonStyle).toHaveLength(2);
    expect(context.teamSeasonStyle[0]).toEqual({
      club_id: "10",
      style_profile: { pressing: 0.6 },
      xg_for: 1.8,
      xg_against: 1.1,
      matches_played: 12,
    });
    expect(context.h2hEdge).toMatchObject({ played: 27 });
    expect(context.lineupSummary).toEqual({ confirmed: true });
    expect(context.lineupCapturedAt).toBe("2026-11-14T12:00:00.000Z");
    expect(context.featureSources).toEqual([
      "match_stats",
      "team_match_stats",
      "historical_odds_snapshots",
      "team_season_stats",
      "h2h_edges",
      "source_records.lineup",
    ]);
  });
});
