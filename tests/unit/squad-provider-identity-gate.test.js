import { describe, expect, it, vi } from "vitest";
import {
  expectedLeagueKeys,
  providerLeagueMatches,
  providerTeamMatchesAliases,
  squadQueryVariants,
} from "../../scripts/worker/squad-team-matching.js";
import { fetchFotMobSquad, findExactFotMobTeam } from "../../scripts/providers/fotmob-squad-provider.js";

const squadPayload = (teamName, playerName, leagueName = null) => ({
  details: { name: teamName },
  fixtures: leagueName ? { allFixtures: { fixtures: [{ tournament: { name: leagueName } }] } } : undefined,
  squad: {
    squad: [{ title: "keepers", members: [{ id: 1, name: playerName, positionIdsDesc: "GK" }] }],
  },
});

describe("squad provideridentiteit", () => {
  it("geeft de negen nieuwe mislukkingen zoekvarianten", () => {
    for (const name of [
      "Bayern München",
      "Bayern Munich",
      "Stade Rennais",
      "Hertha Berlin",
      "FC Köln",
      "AS Roma",
      "Bodø/Glimt",
      "Como",
      "Internazionale",
      "LASK Linz",
    ]) {
      expect(squadQueryVariants(name).length).toBeGreaterThan(1);
    }
  });

  it("herkent de providernaam via de aliaslijst", () => {
    expect(providerTeamMatchesAliases("1. FC Köln", "FC Köln")).toBe(true);
    expect(providerTeamMatchesAliases("Hertha BSC", "Hertha Berlin")).toBe(true);
    expect(providerTeamMatchesAliases("Rennes", "Stade Rennais")).toBe(true);
    expect(providerTeamMatchesAliases("Inter", "Internazionale")).toBe(true);
    expect(providerTeamMatchesAliases("LASK", "LASK Linz")).toBe(true);
    expect(providerTeamMatchesAliases("Bodø/Glimt", "Bodo/Glimt")).toBe(true);
    expect(providerTeamMatchesAliases("Roma", "AS Roma")).toBe(true);
    expect(providerTeamMatchesAliases("Bayern München", "Bayern Munich")).toBe(true);
    expect(providerTeamMatchesAliases("Inter Miami", "Internazionale")).toBe(false);
  });

  it("leidt alleen nationale competities af als competitiecontrole", () => {
    expect(expectedLeagueKeys(["Europe - Champions League", "Germany - Bundesliga"])).toEqual(["bundesliga"]);
    expect(expectedLeagueKeys(["Europe - Europa League"])).toEqual([]);
    expect(expectedLeagueKeys([])).toEqual([]);
    expect(providerLeagueMatches("Bundesliga", ["bundesliga"])).toBe(true);
    expect(providerLeagueMatches("2. Bundesliga", ["bundesliga"])).toBe(false);
  });

  it("weigert een gelijknamige club uit een andere competitie", () => {
    const search = [{ suggestions: [{ type: "team", id: "1", name: "Hertha BSC", leagueName: "2. Bundesliga" }] }];
    expect(findExactFotMobTeam(search, "Hertha Berlin")).not.toBeNull();
    expect(findExactFotMobTeam(search, "Hertha Berlin", { expectedLeagues: ["bundesliga"] })).toBeNull();
    const inCompetition = [{ suggestions: [{ type: "team", id: "2", name: "Hertha BSC", leagueName: "Bundesliga" }] }];
    expect(findExactFotMobTeam(inCompetition, "Hertha Berlin", { expectedLeagues: ["bundesliga"] })?.id).toBe("2");
  });

  it("valt terug op een naamzoekopdracht als het fixture-ID een andere club is", async () => {
    const search = [{ suggestions: [{ type: "team", id: "9823", name: "Bayern München", leagueName: "Bundesliga" }] }];
    const fetchJson = vi.fn()
      .mockResolvedValueOnce(squadPayload("Monza", "Monza Keeper"))
      .mockResolvedValueOnce(search)
      .mockResolvedValueOnce(squadPayload("Bayern München", "Manuel Neuer"));
    const profile = await fetchFotMobSquad({
      teamName: "Bayern Munich",
      teamIds: ["fotmob-999"],
      competitions: ["Germany - Bundesliga"],
      fetchJson,
    });
    expect(profile?.providerTeamId).toBe("9823");
    expect(profile?.providerTeamName).toBe("Bayern München");
    expect(fetchJson.mock.calls[1][0]).toContain("search/suggest");
  });

  it("weigert een selectie waarvan de competitie aantoonbaar niet klopt", async () => {
    const fetchJson = vi.fn()
      .mockResolvedValueOnce(squadPayload("Como", "Como Keeper", "Serie B"))
      .mockResolvedValueOnce([{ suggestions: [{ type: "team", id: "6", name: "Como", leagueName: "Serie B" }] }]);
    const profile = await fetchFotMobSquad({
      teamName: "Como",
      teamIds: ["fotmob-5"],
      competitions: ["Italy - Serie A"],
      fetchJson,
    });
    expect(profile).toBeNull();
  });

  it("accepteert de selectie wanneer de competitie wel klopt", async () => {
    const fetchJson = vi.fn().mockResolvedValueOnce(squadPayload("Como", "Como Keeper", "Serie A"));
    const profile = await fetchFotMobSquad({
      teamName: "Como",
      teamIds: ["fotmob-5"],
      competitions: ["Italy - Serie A"],
      fetchJson,
    });
    expect(profile?.providerTeamId).toBe("5");
  });
});
