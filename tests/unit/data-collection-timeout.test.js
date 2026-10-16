import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout, fetchExternalJson, mapWithConcurrency, fetchEspnScoreboardEvents } from '../../scripts/worker/data-collection.js';
afterEach(() => vi.unstubAllGlobals());
describe('provider deadlines', () => {
  it('reuses overlapping ESPN dates without adding requests or caching failed responses', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ events: [] }) }));
    vi.stubGlobal('fetch', fetcher);
    const deps = { espnScoreboardLeagues: { league: 'test' }, leagues: [{ label: 'league' }], scoreboardCache: new Map(), sleep: async () => {} };
    await fetchEspnScoreboardEvents('2026-10-15', deps);
    await fetchEspnScoreboardEvents('2026-10-16', deps);
    expect(fetcher).toHaveBeenCalledTimes(3);
    deps.scoreboardCache.clear();
    fetcher.mockResolvedValue({ ok: false });
    await fetchEspnScoreboardEvents('2026-10-15', deps);
    expect(deps.scoreboardCache.size).toBe(0);
  });
  it('bounds parallel requests and preserves deterministic source order', async () => {
    let active = 0, peak = 0;
    const output = await mapWithConcurrency([4,3,2,1,0], 3, async value => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, value * 5));
      active--;
      return value;
    });
    expect(peak).toBe(3);
    expect(output).toEqual([4,3,2,1,0]);
  });
  it('aborts a stalled body after headers already arrived', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, { signal }) => ({ ok: true, json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })));
    const response = await fetchWithTimeout('https://example.test', {}, 30);
    await expect(response.json()).rejects.toThrow();
  });
  it('falls back on a stalled JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, { signal }) => ({ ok: true, json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })));
    expect(await fetchExternalJson('https://example.test', {}, 30)).toBeNull();
  });
  it('preserves caller cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, { signal }) => ({ signal })));
    const caller = new AbortController();
    const response = await fetchWithTimeout('https://example.test', { signal: caller.signal });
    caller.abort();
    expect(response.signal.aborted).toBe(true);
  });
});
