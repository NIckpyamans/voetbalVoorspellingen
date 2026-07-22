import { describe, expect, it } from "vitest";
import { parseSkySportsScheduledEventsHtml } from "../../scripts/worker/data-collection.js";

const deps = {
  skyCompetitionToLabel: {
    "Europa League Qualifying": "Europe - Europa League",
  },
  leagues: [
    { label: "Europe - Europa League", name: "Europa League", country: "Europe", type: "cup" },
  ],
  normalizeName: (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  buildFootballDataKickoffIso: (date, time) => `${date}T${time}:00+02:00`,
  isWomenContext: () => false,
  isYouthContext: () => false,
};

describe("Sky Sports fixture parser", () => {
  it("parses mapped fixtures and preserves provider identity and badges", () => {
    const state = {
      id: 569394,
      start: { time: "17:00" },
      competition: {
        name: { full: "Europa League Qualifying" },
        round: { name: { full: "Second Round" } },
      },
      teams: {
        home: { id: 2553, badge: "https://img/home.png", name: { full: "Qarabag FK" } },
        away: { id: 1520, badge: "https://img/away.png", name: { full: "CSKA Sofia" } },
      },
    };
    const encoded = JSON.stringify(state).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const html = `<div data-component-name="ui-sport-match-score" data-state="${encoded}"></div>`;

    const events = parseSkySportsScheduledEventsHtml(html, "2026-07-23", deps);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "sky-569394",
      source: "sky-fixture-fallback",
      homeTeam: { id: "sky-2553", name: "Qarabag FK", logoUrl: "https://img/home.png" },
      awayTeam: { id: "sky-1520", name: "CSKA Sofia", logoUrl: "https://img/away.png" },
      uniqueTournament: { name: "Europa League" },
      roundInfo: { name: "Second Round" },
    });
  });

  it("ignores competitions outside the configured catalog", () => {
    const state = {
      id: 1,
      start: { time: "20:00" },
      competition: { name: { full: "Untracked League" } },
      teams: {
        home: { name: { full: "Home" } },
        away: { name: { full: "Away" } },
      },
    };
    const encoded = JSON.stringify(state).replace(/"/g, "&quot;");
    const html = `<div data-component-name="ui-sport-match-score" data-state="${encoded}"></div>`;

    expect(parseSkySportsScheduledEventsHtml(html, "2026-07-23", deps)).toEqual([]);
  });
});
