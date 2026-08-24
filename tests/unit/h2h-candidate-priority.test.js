import { describe, expect, it } from "vitest";
import { orderH2HCandidatesByCompetition, orderH2HCandidatesByLastAttempt } from "../../scripts/worker/h2h-candidate-priority.js";

describe("H2H candidate priority", () => {
  it("checks never-attempted fixtures before recently checked fixtures", () => {
    const candidates = [
      { match_id: "recent", kickoff_at: "2026-08-18T18:00:00Z" },
      { match_id: "new", kickoff_at: "2026-08-20T18:00:00Z" },
      { match_id: "old", kickoff_at: "2026-08-19T18:00:00Z" },
    ];
    const ordered = orderH2HCandidatesByLastAttempt(candidates, {
      recent: { checkedAt: "2026-08-18T10:00:00Z" },
      old: { checkedAt: "2026-08-17T10:00:00Z" },
    });
    expect(ordered.map((item) => item.match_id)).toEqual(["new", "old", "recent"]);
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
