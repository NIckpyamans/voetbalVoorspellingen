import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchApiFootballH2HProfile,
  resetApiFootballAccountBlockForTests,
  summarizeApiFootballUsage,
} from "../../scripts/api-football-provider.js";
import { shouldTripProviderCircuit } from "../../scripts/worker/provider-circuits.js";

const SUSPENDED_PAYLOAD = {
  get: "teams",
  errors: { access: "Your account is suspended, check on https://dashboard.api-football.com/" },
  results: 0,
  response: [],
};

describe("API-Football accountblokkade", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.API_KEY_API_FOOTBALL;
    delete process.env.API_FOOTBALL_MAX_FETCHES_PER_RUN;
    delete process.env.API_FOOTBALL_H2H_ENABLED;
    resetApiFootballAccountBlockForTests();
  });

  it("herkent een geschorst account als auth_or_plan, zodat het circuit opent", async () => {
    process.env.API_KEY_API_FOOTBALL = "test-key";
    process.env.API_FOOTBALL_H2H_ENABLED = "true";
    delete process.env.API_FOOTBALL_MAX_FETCHES_PER_RUN;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(SUSPENDED_PAYLOAD), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const store = { apiFootballTeamMap: {}, apiFootballH2HCache: {} };
    const profile = await fetchApiFootballH2HProfile({
      store,
      homeName: "Ajax",
      awayName: "PSV",
      leagueLabel: "Netherlands - Eredivisie",
    });

    expect(profile).toBeNull();
    const entry = Object.values(store.apiFootballH2HCache)[0];
    expect(entry.errorCategory).toBe("auth_or_plan");
    expect(entry.error).toContain("suspended");
    expect(shouldTripProviderCircuit(entry.errorCategory)).toBe(true);
    expect(summarizeApiFootballUsage(store).accountBlocked).toContain("suspended");
  });

  it("staakt verdere aanvragen zodra de accountblokkade bekend is", async () => {
    process.env.API_KEY_API_FOOTBALL = "test-key";
    process.env.API_FOOTBALL_H2H_ENABLED = "true";
    delete process.env.API_FOOTBALL_MAX_FETCHES_PER_RUN;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(SUSPENDED_PAYLOAD), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const store = { apiFootballTeamMap: {}, apiFootballH2HCache: {} };
    await fetchApiFootballH2HProfile({
      store,
      homeName: "Ajax",
      awayName: "PSV",
      leagueLabel: "Netherlands - Eredivisie",
    });
    const requestsAfterFirstPair = fetchImpl.mock.calls.length;
    expect(requestsAfterFirstPair).toBeGreaterThan(0);

    await fetchApiFootballH2HProfile({
      store,
      homeName: "Feyenoord",
      awayName: "Twente",
      leagueLabel: "Netherlands - Eredivisie",
    });

    expect(fetchImpl.mock.calls.length).toBe(requestsAfterFirstPair);
  });
});
