import { describe, expect, it } from "vitest";
import { orderH2HCandidatesByLastAttempt } from "../../scripts/worker/h2h-candidate-priority.js";

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
});
