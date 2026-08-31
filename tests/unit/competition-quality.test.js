import { describe, expect, it } from "vitest";

import { buildCompetitionQuality } from "../../scripts/worker/competition-quality.js";

describe("competition quality", () => {
  it("joins array-shaped model performance by league key", () => {
    const quality = buildCompetitionQuality([
      {
        league: "England - Premier League",
        h2h: { played: 5 },
        homeRecent: { gamesPlayed: 5 },
        awayRecent: { gamesPlayed: 5 },
        lineupSummary: { confirmed: true },
        oddsAtPrediction: { home: 2.1 },
      },
    ], {
      byLeague: [{
        key: "England - Premier League",
        matches: 42,
        outcomeHitRate: 0.571,
        avgBrierScore: 0.214,
        exactHitRate: 0.119,
        roiTotal: 1.6,
      }],
    });

    expect(quality).toHaveLength(1);
    expect(quality[0].coverage).toMatchObject({ h2h: 1, form: 1, confirmedLineups: 1, odds: 1 });
    expect(quality[0].performance).toMatchObject({
      evaluations: 42,
      outcomeHitRate: 0.571,
      brierScore: 0.214,
      exactHitRate: 0.119,
      roi: 1.6,
    });
    expect(quality[0]).toMatchObject({ modelReady: false, modelReadyReason: "minder dan 100 evaluaties" });
  });
});
