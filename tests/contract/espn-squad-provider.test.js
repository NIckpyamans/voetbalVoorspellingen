import { describe, expect, it, vi } from "vitest";
import { fetchEspnSquad, findExactEspnTeam, parseEspnRoster } from "../../scripts/providers/espn-squad-provider.js";

describe("ESPN squad provider", () => {
  it("matches only exact normalized team variants", () => {
    const teams = [
      { id: "139", displayName: "Ajax Amsterdam", shortDisplayName: "Ajax" },
      { id: "999", displayName: "Jong Ajax" },
    ];
    expect(findExactEspnTeam(teams, "Ajax")?.id).toBe("139");
    expect(findExactEspnTeam(teams, "Ajax U21")).toBeNull();
  });

  it("normalizes roster athletes with source lineage", () => {
    const players = parseEspnRoster({ athletes: [{ id: "1", displayName: "Test Speler", position: { displayName: "Forward" }, citizenship: "Nederland", status: { name: "Active" } }] });
    expect(players).toEqual([expect.objectContaining({ id: "espn:1", name: "Test Speler", position: "Forward", source: "ESPN" })]);
  });

  it("uses a known ESPN team id without a broad team search", async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      team: { displayName: "Ajax Amsterdam" },
      athletes: [{ id: "1", displayName: "Test Speler", position: { displayName: "Forward" } }],
    });
    const profile = await fetchEspnSquad({
      teamName: "Ajax",
      leagues: ["Netherlands - Eredivisie"],
      knownTeams: [{ name: "Ajax", espnTeamId: "139", espnLeagueCode: "ned.1" }],
      fetchJson,
    });
    expect(profile).toEqual(expect.objectContaining({ providerTeamId: "139", leagueCode: "ned.1" }));
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0][0]).toContain("/ned.1/teams/139/roster");
  });
});
