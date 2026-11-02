import { describe, expect, it, vi } from "vitest";
import { createProviderCircuit, wrapFetchWithCircuit } from "../../scripts/worker/provider-circuit.js";

describe("provider 403 circuit", () => {
  it("blokkeert een provider na de eerste 403 voor de rest van de run", async () => {
    const blocks = [];
    const circuit = createProviderCircuit({ onBlock: (host) => blocks.push(host) });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 403 }));
    const safeFetch = wrapFetchWithCircuit(fetchImpl, circuit);

    const first = await safeFetch("https://api.sofascore.com/api/v1/sport/football/events/live");
    expect(first.status).toBe(403);
    expect(blocks).toEqual(["api.sofascore.com"]);

    const second = await safeFetch("https://api.sofascore.com/api/v1/match/123");
    expect(second.status).toBe(403);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("laat fallbackbronnen en andere hosts ongemoeid", async () => {
    const circuit = createProviderCircuit();
    const fetchImpl = vi.fn(async () => new Response("[]", { status: 200 }));
    const safeFetch = wrapFetchWithCircuit(fetchImpl, circuit);
    const response = await safeFetch("https://site.api.espn.com/apis/site/v2/sports/soccer/scoreboard");
    expect(response.status).toBe(200);
    expect(circuit.blockedHosts()).toEqual([]);
  });

  it("telt fouten per host en blokkeert alleen op 403", () => {
    const circuit = createProviderCircuit();
    expect(circuit.record("https://www.thesportsdb.com/api/v1/json/3/eventsday.php", 429)).toBe(false);
    expect(circuit.isBlocked("https://www.thesportsdb.com/api/v1/json/3/eventsday.php")).toBe(false);
    expect(circuit.record("https://www.thesportsdb.com/api/v1/json/3/eventsday.php", 403)).toBe(true);
    expect(circuit.isBlocked("https://www.thesportsdb.com/api/v1/json/3/lookup_all_teams.php")).toBe(true);
    expect(circuit.stats()).toEqual({ "www.thesportsdb.com": 1 });
  });
});
