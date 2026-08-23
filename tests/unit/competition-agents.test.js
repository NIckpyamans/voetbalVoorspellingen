import { describe, expect, it } from "vitest";
import { getCompetitionProviderOrder } from "../../scripts/worker/competition-agents.js";

describe("competition provider routing", () => {
  it("uses APIfootball.com only for supported free-plan leagues", () => {
    expect(getCompetitionProviderOrder("England - Championship", "lineups")).toContain("apifootball-com");
    expect(getCompetitionProviderOrder("France - Ligue 2", "h2h")).toContain("apifootball-com");
    expect(getCompetitionProviderOrder("Netherlands - Eredivisie", "lineups")).not.toContain("apifootball-com");
    expect(getCompetitionProviderOrder("Germany - Bundesliga", "h2h")).not.toContain("apifootball-com");
  });
});
