import { describe, expect, it } from "vitest";
import { parseFotmobScheduledEvents } from "../../scripts/worker/data-collection.js";

const deps = {
  trackedTeamNames: ["FC Barcelona", "ADO Den Haag", "Heracles Almelo", "Excelsior"],
  fotmobStandingLeagues: {
    "Netherlands - Eredivisie": { id: 57 },
    "Netherlands - Eerste Divisie": { id: 111 },
  },
  fotmobCompetitionToLabel: {
    "Champions League Qualification": "Europe - Champions League",
  },
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

  it("keeps every fixture from each mapped followed competition", () => {
    const leaguePayload = {
      leagues: [{
        id: 111,
        name: "Eerste Divisie",
        matches: [
          { id: 11, status: { utcTime: "2026-07-24T18:00:00.000Z" }, home: { id: 1, name: "De Graafschap" }, away: { id: 2, name: "Jong AZ Alkmaar" } },
          { id: 12, status: { utcTime: "2026-07-24T18:00:00.000Z" }, home: { id: 3, name: "Jong Ajax" }, away: { id: 4, name: "FC Emmen" } },
          { id: 13, status: { utcTime: "2026-07-24T18:00:00.000Z" }, home: { id: 5, name: "Jong FC Utrecht" }, away: { id: 6, name: "Vitesse" } },
        ],
      }],
    };
    const events = parseFotmobScheduledEvents(leaguePayload, "2026-07-24", deps);
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.tournament.category.name === "Netherlands")).toBe(true);
    expect(events.every((event) => event.leagueLabel === "Netherlands - Eerste Divisie")).toBe(true);
    expect(events.map((event) => event.homeTeam.name)).toEqual(["De Graafschap", "Jong Ajax", "Jong FC Utrecht"]);
  });

  it("keeps season-specific UEFA qualifier ids by competition name", () => {
    const qualifierPayload = {
      leagues: [{
        id: 937348,
        name: "Champions League Qualification",
        matches: [{
          id: 5987804,
          statusId: 6,
          status: { utcTime: "2026-08-19T19:00:00.000Z", finished: true },
          home: { id: 1020, name: "NEC Nijmegen", score: 1 },
          away: { id: 8514, name: "Bodø/Glimt", score: 3 },
        }],
      }],
    };
    const events = parseFotmobScheduledEvents(qualifierPayload, "2026-08-19", {
      ...deps,
      toAmsterdamDateKey: () => "2026-08-19",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      leagueLabel: "Europe - Champions League",
      status: { type: "finished" },
      homeScore: { current: 1 },
      awayScore: { current: 3 },
    });
  });

  it("maps scheduled fixtures for all three European club competitions", () => {
    const events = parseFotmobScheduledEvents({
      leagues: [
        { id: 943230, primaryId: 42, name: "Champions League", season: { name: "2026/2027" }, matches: [{ id: 100, tournamentStage: "3", status: { utcTime: "2026-10-20T16:45:00.000Z" }, home: { id: 1, name: "Fenerbahçe" }, away: { id: 2, name: "Slavia Prague" } }] },
        { id: 943229, primaryId: 73, name: "Europa League", season: { name: "2026/2027" }, matches: [{ id: 101, tournamentStage: "3", status: { utcTime: "2026-10-20T16:45:00.000Z" }, home: { id: 3, name: "Celtic" }, away: { id: 4, name: "Roma" } }] },
        { id: 943231, primaryId: 10216, name: "Conference League", season: { name: "2026/2027" }, matches: [{ id: 102, tournamentStage: "3", status: { utcTime: "2026-10-20T16:45:00.000Z" }, home: { id: 5, name: "Ajax" }, away: { id: 6, name: "AGF" } }] },
      ],
    }, "2026-10-20", {
      ...deps,
      fotmobStandingLeagues: {
        ...deps.fotmobStandingLeagues,
        "Europe - Champions League": { id: 42 },
        "Europe - Europa League": { id: 73 },
        "Europe - Conference League": { id: 10216 },
      },
      toAmsterdamDateKey: (value) => new Date(value).toISOString().slice(0, 10),
    });
    expect(events.map((event) => event.leagueLabel)).toEqual([
      "Europe - Champions League",
      "Europe - Europa League",
      "Europe - Conference League",
    ]);
    expect(events[0]).toMatchObject({
      id: "fotmob-100",
      uniqueTournament: { id: 42 },
      homeTeam: { name: "Fenerbahçe" },
      awayTeam: { name: "Slavia Prague" },
    });
    expect(events[1].leagueLabel).toBe("Europe - Europa League");
    expect(events[2]).toMatchObject({ leagueLabel: "Europe - Conference League", standingsProvisional: true });
  });

  it("keeps UEFA fixtures dated October 13-15 in the Amsterdam calendar window", () => {
    const leagues = [
      {
        id: 943230,
        primaryId: 42,
        name: "Champions League",
        matches: [
          { id: 6106414, status: { utcTime: "2026-10-13T16:45:00.000Z" }, home: { id: 8588, name: "Lens" }, away: { id: 9768, name: "Sporting CP" } },
          { id: 6106309, status: { utcTime: "2026-10-14T16:45:00.000Z" }, home: { id: 10235, name: "Feyenoord" }, away: { id: 10171, name: "Como" } },
        ],
      },
      {
        id: 943229,
        primaryId: 73,
        name: "Europa League",
        matches: [
          { id: 6112265, status: { utcTime: "2026-10-15T16:45:00.000Z" }, home: { id: 10229, name: "AZ Alkmaar" }, away: { id: 9754, name: "Hapoel Beer Sheva" } },
        ],
      },
      {
        id: 943231,
        primaryId: 10216,
        name: "Conference League",
        matches: [
          { id: 6112413, status: { utcTime: "2026-10-15T16:45:00.000Z" }, home: { id: 9991, name: "Gent" }, away: { id: 8071, name: "AGF" } },
        ],
      },
    ];
    const competitionDeps = {
      ...deps,
      fotmobStandingLeagues: {
        ...deps.fotmobStandingLeagues,
        "Europe - Champions League": { id: 42 },
        "Europe - Europa League": { id: 73 },
        "Europe - Conference League": { id: 10216 },
      },
      toAmsterdamDateKey: (value) => new Date(value).toISOString().slice(0, 10),
    };
    const expected = [
      ["2026-10-13", "Europe - Champions League", "Lens", "Sporting CP"],
      ["2026-10-14", "Europe - Champions League", "Feyenoord", "Como"],
      ["2026-10-15", "Europe - Europa League", "AZ Alkmaar", "Hapoel Beer Sheva"],
      ["2026-10-15", "Europe - Conference League", "Gent", "AGF"],
    ];

    for (const [date, leagueLabel, home, away] of expected) {
      const events = parseFotmobScheduledEvents({ leagues }, date, competitionDeps);
      expect(events).toContainEqual(expect.objectContaining({
        leagueLabel,
        homeTeam: expect.objectContaining({ name: home }),
        awayTeam: expect.objectContaining({ name: away }),
        status: { type: "notstarted", description: "NS" },
      }));
    }
  });

  it("maps season-specific domestic ids through FotMob primaryId", () => {
    const domesticPayload = {
      leagues: [{
        id: 937276,
        primaryId: 57,
        name: "Eredivisie",
        matches: [
          {
            id: 5781726,
            statusId: 6,
            status: { utcTime: "2026-08-30T10:15:00.000Z", finished: true },
            home: { id: 9908, name: "FC Utrecht", score: 1 },
            away: { id: 8640, name: "PSV Eindhoven", score: 6 },
          },
          {
            id: 5781730,
            statusId: 6,
            status: { utcTime: "2026-08-30T14:45:00.000Z", finished: true },
            home: { id: 6414, name: "Telstar", score: 0 },
            away: { id: 8593, name: "Ajax", score: 4 },
          },
        ],
      }],
    };
    const events = parseFotmobScheduledEvents(domesticPayload, "2026-08-30", {
      ...deps,
      toAmsterdamDateKey: () => "2026-08-30",
    });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      id: "fotmob-5781730",
      leagueLabel: "Netherlands - Eredivisie",
      status: { type: "finished" },
      homeTeam: { name: "Telstar" },
      awayTeam: { name: "Ajax" },
      homeScore: { current: 0 },
      awayScore: { current: 4 },
      fotmobMeta: { leagueId: 937276 },
    });
  });
});
