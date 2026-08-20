import { describe, expect, it } from "vitest";
import { normalizeTransfermarktClubName, parseTransfermarktCsv } from "../../scripts/providers/transfermarkt-dataset-utils.js";
import { evaluateGoalApiAcceptance, segmentForLeague } from "../../scripts/providers/goal-api-acceptance-utils.js";
import { extractBetfairClosingMarkets } from "../../scripts/providers/betfair-history-utils.js";

describe("new free data source safety", () => {
  it("parses quoted Transfermarkt CSV fields", () => {
    const rows = parseTransfermarktCsv('club_id,name,note\n1,"Club, United","a ""quoted"" value"\n');
    expect(rows).toEqual([{ club_id: "1", name: "Club, United", note: 'a "quoted" value' }]);
    expect(normalizeTransfermarktClubName("AFC Club United")).toBe("united");
  });

  it("requires fourteen days and segment evidence before GOAL promotion", () => {
    const history = Array.from({ length: 14 }, (_, index) => ({
      checkedAt: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
      providerReachable: true,
      checked: 15,
      segments: {
        domestic: { checked: 5, mapped: 5 },
        uefa: { checked: 5, mapped: 4 },
        friendly: { checked: 5, mapped: 3 },
      },
    }));
    const result = evaluateGoalApiAcceptance(history, new Date(Date.UTC(2026, 7, 14)).toISOString());
    expect(result.accepted).toBe(true);
    expect(segmentForLeague("World - Club Friendlies")).toBe("friendly");
  });

  it("extracts only the last pre-kickoff Betfair prices", () => {
    const kickoff = "2026-08-20T18:00:00.000Z";
    const lines = [
      JSON.stringify({ pt: Date.parse("2026-08-20T17:58:00.000Z"), mc: [{ id: "1.1", marketDefinition: { eventName: "A v B", marketType: "MATCH_ODDS", marketTime: kickoff, runners: [{ id: 1, name: "A" }, { id: 2, name: "Draw" }, { id: 3, name: "B" }] }, rc: [{ id: 1, ltp: 2 }, { id: 2, ltp: 3 }, { id: 3, ltp: 4 }] }] }),
      JSON.stringify({ pt: Date.parse("2026-08-20T18:01:00.000Z"), mc: [{ id: "1.1", rc: [{ id: 1, ltp: 9 }] }] }),
    ];
    const markets = extractBetfairClosingMarkets(lines);
    expect(markets).toHaveLength(1);
    expect(markets[0].closing.find((price) => price.selectionId === "1").odds).toBe(2);
    expect(markets[0].usage).toBe("offline_calibration_only");
  });
});
