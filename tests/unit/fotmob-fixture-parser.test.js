import { describe, expect, it } from "vitest";
import { parseFotmobScheduledEvents } from "../../scripts/worker/data-collection.js";

const deps = {
  trackedTeamNames: ["FC Barcelona", "ADO Den Haag", "Heracles Almelo", "Excelsior"],
  normalizeName: (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  isWomenContext: () => false,
  isYouthContext: (_league, home, away) => /u-?\d{2}/i.test(`${home} ${away}`),
  toAmsterdamDateKey: () => "2026-07-24",
  toNumber: (value) => Number(value),
};

const payload = {
  leagues: [{
    id: 915708,
    name: "Club Friendlies",
    matches: [
      { id: 1, statusId: 1, status: { utcTime: "2026-07-24T18:00:00.000Z" }, home: { id: 83, name: "Barcelona", score: 0 }, away: { id: 9, name: "CE Europa", score: 0 } },
      { id: 2, statusId: 1, status: { utcTime: "2026-07-24T16:30:00.000Z" }, home: { id: 10, name: "Heracles", score: 0 }, away: { id: 11, name: "Excelsior", score: 0 } },
      { id: 3, statusId: 1, status: { utcTime: "2026-07-24T17:00:00.000Z" }, home: { id: 12, name: "Untracked FC", score: 0 }, away: { id: 13, name: "Unknown Town", score: 0 } },
      { id: 4, statusId: 1, status: { utcTime: "2026-07-24T17:00:00.000Z" }, home: { id: 14, name: "Barcelona U21", score: 0 }, away: { id: 15, name: "Other", score: 0 } },
    ],
  }],
};

describe("FotMob fixture parser", () => {
  it("keeps only first-team friendlies involving followed competition clubs", () => {
    const events = parseFotmobScheduledEvents(payload, "2026-07-24", deps);
    expect(events.map((event) => `${event.homeTeam.name}-${event.awayTeam.name}`)).toEqual([
      "Barcelona-CE Europa",
      "Heracles-Excelsior",
    ]);
    expect(events[0]).toMatchObject({ source: "fotmob-fixture-fallback", status: { type: "notstarted" } });
  });

  it("publishes live scores but never pre-match zeroes", () => {
    const livePayload = structuredClone(payload);
    livePayload.leagues[0].matches = [{
      id: 5,
      statusId: 3,
      status: { utcTime: "2026-07-24T12:15:00.000Z", started: true, ongoing: true, liveTime: { short: "82'" } },
      home: { id: 1, name: "Lommel", score: 0 },
      away: { id: 2, name: "ADO Den Haag", score: 4 },
    }];
    expect(parseFotmobScheduledEvents(livePayload, "2026-07-24", deps)[0]).toMatchObject({
      status: { type: "inprogress" },
      homeScore: { current: 0 },
      awayScore: { current: 4 },
    });
  });
});
