import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMatchIndex,
  buildMatchStore,
  loadMatchStore,
  recordFromReview,
  sourceFingerprint,
} from "../../shared/matchStore.js";

describe("bronhash", () => {
  it("verandert mee met de inhoud van de brondata", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "match-fingerprint-"));
    try {
      fs.mkdirSync(path.join(dataDir, "days"), { recursive: true });
      const dayFile = path.join(dataDir, "days", "2026-10-01.json");
      fs.writeFileSync(dayFile, JSON.stringify({ matches: [] }));
      const before = sourceFingerprint(dataDir);
      expect(before).toHaveLength(16);
      // Aanraken zonder inhoudswijziging verandert de hash niet.
      fs.utimesSync(dayFile, new Date(), new Date());
      expect(sourceFingerprint(dataDir)).toBe(before);
      fs.appendFileSync(dayFile, "\n");
      expect(sourceFingerprint(dataDir)).not.toBe(before);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("herbouwt wanneer de opgeslagen hash niet klopt", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "match-refresh-"));
    try {
      fs.mkdirSync(path.join(dataDir, "days"), { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, "days", "2026-10-01.json"),
        JSON.stringify({
          matches: [
            { id: "t1", date: "2026-10-01", homeTeamName: "A", awayTeamName: "B", score: "1-0", status: "FT" },
          ],
        }),
      );
      const store = buildMatchStore({
        dayMatches: [{ id: "t1", date: "2026-10-01", homeTeamName: "A", awayTeamName: "B", score: "1-0", status: "FT" }],
        sourceFingerprint: sourceFingerprint(dataDir),
      });
      fs.writeFileSync(path.join(dataDir, "match-store.json"), JSON.stringify({ ...store, marker: "from-disk" }));
      fs.writeFileSync(path.join(dataDir, "match-index.json"), JSON.stringify(buildMatchIndex(store)));

      const fresh = loadMatchStore(dataDir);
      expect(fresh.fresh).toBe(true);
      expect(fresh.store.marker).toBe("from-disk");

      // Broninhoud wijzigt: de hash klopt niet meer, dus opnieuw opbouwen.
      fs.appendFileSync(path.join(dataDir, "days", "2026-10-01.json"), "\n");
      const rebuilt = loadMatchStore(dataDir);
      expect(rebuilt.fresh).toBe(false);
      expect(rebuilt.store.marker).toBeUndefined();
      expect(rebuilt.store.matches.t1).toMatchObject({ d: "2026-10-01", hs: 1, as: 0 });
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("evaluatievelden in de review", () => {
  it("legt marktkansen, uitkomst en modelmaten compact vast", () => {
    const record = recordFromReview({
      matchId: "q2",
      date: "2026-10-02",
      kickoff: "2026-10-02T18:00:00Z",
      league: "Netherlands - Eredivisie",
      homeTeamName: "A",
      awayTeamName: "B",
      actualScore: "2-1",
      actualOutcome: "H",
      outcomeHit: true,
      logLoss: 0.5123,
      brierScore: 0.4211,
      oddsAtPrediction: {
        home: 1.5,
        draw: 4.5,
        away: 6,
        capturedAt: "2026-10-02T09:00:00Z",
      },
    });
    expect(record.y).toBe("H");
    expect(record.ll).toBeCloseTo(0.512, 3);
    expect(record.bs).toBeCloseTo(0.421, 3);
    expect(record.mp).toHaveLength(3);
    expect(record.mp.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 2);
    // 18:00 aftrap, 09:00 vastgelegd = 9 uur voor aftrap.
    expect(record.dq).toMatchObject({ h: 9, f: "recent" });
  });

  it("bewaart geen marktkansen wanneer de odds pas na de aftrap zijn vastgelegd", () => {
    const record = recordFromReview({
      matchId: "q3",
      date: "2026-10-03",
      kickoff: "2026-10-03T18:00:00Z",
      homeTeamName: "A",
      awayTeamName: "B",
      actualScore: "0-0",
      actualOutcome: "D",
      oddsAtPrediction: {
        home: 1.9,
        draw: 3.4,
        away: 4.1,
        capturedAt: "2026-10-03T20:30:00Z",
      },
    });
    expect(record.mp).toBeUndefined();
    expect(record.dq?.f).toBeUndefined();
  });

  it("gebruikt het marktbestand als fallback met bronmarkering", () => {
    const store = buildMatchStore({
      dayMatches: [],
      reviews: {
        r1: {
          matchId: "r1",
          date: "2026-04-05",
          league: "Eredivisie",
          homeTeamName: "Manchester City",
          awayTeamName: "Arsenal",
          actualScore: "2-1",
          actualOutcome: "H",
          outcomeHit: true,
        },
      },
      marketOdds: { entries: { "2026-04-05|manchester city|arsenal": [2.05, 3.5, 3.6] } },
    });
    const record = store.matches.r1;
    expect(record.mks).toBe("fdc");
    expect(record.y).toBe("H");
    if (record.mp) {
      expect(record.mp).toHaveLength(3);
    }
  });
});
