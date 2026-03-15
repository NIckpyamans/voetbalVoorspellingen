// api/standings.ts — geeft competitiestand terug vanuit server_data.json

const GITHUB_RAW = process.env.DATA_URL ||
  'https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  try {
    const ghRes = await fetch(`${GITHUB_RAW}?t=${Date.now()}`);
    if (!ghRes.ok) return res.status(200).json({ standings: {} });

    const store = await ghRes.json();
    return res.status(200).json({
      standings: store.standings || {},
      lastRun: store.lastRun
    });

  } catch (err: any) {
    return res.status(200).json({ standings: {}, error: err?.message });
  }
}
