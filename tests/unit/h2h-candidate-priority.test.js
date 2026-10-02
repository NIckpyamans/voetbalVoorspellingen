import { describe, expect, it } from "vitest";
import { orderH2HCandidatesByCompetition, orderH2HCandidatesByLastAttempt } from "../../scripts/worker/h2h-candidate-priority.js";

describe("H2H candidate priority", () => {
  it("prioritizes fixtures missing H2H while retaining kickoff and retry ordering", () => {
    const ordered = orderH2HCandidatesByLastAttempt([
      { match_id: "has-old", kickoff_at: "2026-08-18T18:00:00Z", h2h: { played: 2 } },
      { match_id: "gap-late", kickoff_at: "2026-08-21T18:00:00Z" },
      { match_id: "gap-early", kickoff_at: "2026-08-20T18:00:00Z" },
    ], {
      "gap-early": { checkedAt: "2026-08-20T12:00:00Z" },
    });
    expect(ordered.map((item) => item.match_id)).toEqual(["gap-early", "gap-late", "has-old"]);
  });

  it("prioritizes earlier unfilled fixtures while retaining last-attempt ordering for the same kickoff", () => {
    const candidates = [
      { match_id: "recent", kickoff_at: "2026-08-18T18:00:00Z" },
      { match_id: "new", kickoff_at: "2026-08-20T18:00:00Z" },
      { match_id: "old", kickoff_at: "2026-08-19T18:00:00Z" },
    ];
    const ordered = orderH2HCandidatesByLastAttempt(candidates, {
      recent: { checkedAt: "2026-08-18T10:00:00Z" },
      old: { checkedAt: "2026-08-17T10:00:00Z" },
    });
    expect(ordered.map((item) => item.match_id)).toEqual(["recent", "old", "new"]);
  });

  it("uses kickoff order when fixtures have equal attempt age", () => {
    const ordered = orderH2HCandidatesByLastAttempt([
      { match_id: "later", kickoff_at: "2026-08-20T20:00:00Z" },
      { match_id: "earlier", kickoff_at: "2026-08-20T18:00:00Z" },
    ]);
    expect(ordered.map((item) => item.match_id)).toEqual(["earlier", "later"]);
  });

  it("round-robins competitions so a large qualifier slate cannot starve domestic fixtures", () => {
    const ordered = orderH2HCandidatesByCompetition([
      { match_id: "ucl-1", league: "Europe - Champions League", kickoff_at: "2026-08-20T18:00:00Z" },
      { match_id: "ucl-2", league: "Europe - Champions League", kickoff_at: "2026-08-20T19:00:00Z" },
      { match_id: "ucl-3", league: "Europe - Champions League", kickoff_at: "2026-08-20T20:00:00Z" },
      { match_id: "eredivisie", league: "Netherlands - Eredivisie", kickoff_at: "2026-08-20T20:30:00Z" },
    ]);
    expect(ordered.slice(0, 2).map((item) => item.match_id)).toEqual(["ucl-1", "eredivisie"]);
  });

  it("preserves earliest kickoff priority when round-robinning candidates on a date", () => {
    const ordered = orderH2HCandidatesByCompetition([
      { match_id: "later", league: "England - Premier League", kickoff_at: "2026-08-24T20:00:00Z" },
      { match_id: "earlier", league: "England - Premier League", kickoff_at: "2026-08-24T18:00:00Z" },
    ]);
    expect(ordered.map((item) => item.match_id)).toEqual(["earlier", "later"]);
  });

  it("never lets an untried future fixture displace a retried match kicking off today", () => {
    const ordered = orderH2HCandidatesByCompetition([
      { match_id: "today-retry", league: "England - Premier League", kickoff_at: "2026-08-24T19:00:00Z" },
      { match_id: "future-new", league: "England - Premier League", kickoff_at: "2026-08-30T19:00:00Z" },
    ], {
      "today-retry": { checkedAt: "2026-08-24T12:00:00Z" },
    });
    expect(ordered.map((item) => item.match_id)).toEqual(["today-retry", "future-new"]);
  });
});
