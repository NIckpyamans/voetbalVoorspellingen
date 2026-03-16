// api/standings.ts

const GITHUB_RAW = process.env.DATA_URL ||
  'https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  try {
    const ghRes = await fetch(`${GITHUB_RAW}?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!ghRes.ok) {
      return res.status(200).json({ standings: {}, error: `GitHub ${ghRes.status}` });
    }

    const store = await ghRes.json();

    // Haal standen op — geef ook lastRun mee voor debugging
    return res.status(200).json({
      standings: store.standings || {},
      lastRun: store.lastRun,
      hasMatches: !!store.matches,
      workerVersion: store.workerVersion || 'unknown'
    });

  } catch (err: any) {
    return res.status(200).json({ standings: {}, error: err?.message });
  }
}
