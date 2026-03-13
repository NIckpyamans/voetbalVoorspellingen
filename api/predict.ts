const GITHUB_RAW_URL = process.env.DATA_URL || 
  'https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const date = (req.query?.date as string) || new Date().toISOString().split('T')[0];

    const response = await fetch(GITHUB_RAW_URL, {
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!response.ok) {
      return res.status(200).json({ 
        date, 
        predictions: [], 
        source: 'none',
        error: `GitHub fetch failed: ${response.status}` 
      });
    }

    const store = await response.json();

    if (store.predictions && store.predictions[date]) {
      return res.status(200).json({ 
        date, 
        predictions: store.predictions[date], 
        source: 'server-data',
        lastRun: store.lastRun
      });
    }

    const dates = Object.keys(store.predictions || {}).sort().reverse();
    if (dates.length > 0) {
      const latestDate = dates[0];
      return res.status(200).json({ 
        date: latestDate,
        predictions: store.predictions[latestDate], 
        source: 'server-data-latest',
        lastRun: store.lastRun
      });
    }

    return res.status(200).json({ date, predictions: [], source: 'none' });

  } catch (err: any) {
    console.error('predict api error', err);
    res.status(500).json({ error: err?.message || 'unknown' });
  }
}
