// api/predict.ts
// Geeft voorspellingen terug inclusief odds van bookmakers

const GITHUB_RAW_URL = process.env.DATA_URL ||
  'https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json';

const API_BASE = "https://v3.football.api-sports.io";

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300');

  const API_KEY = process.env.FOOTBALL_API_KEY;

  try {
    const date = (req.query?.date as string) || new Date().toISOString().split('T')[0];

    // 1) Haal server_data.json op van GitHub (AI voorspellingen van worker)
    let serverPredictions: any[] = [];
    try {
      const response = await fetch(GITHUB_RAW_URL, {
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (response.ok) {
        const store = await response.json();
        if (store.predictions?.[date]) {
          serverPredictions = store.predictions[date];
        } else {
          // Geef meest recente terug
          const dates = Object.keys(store.predictions || {}).sort().reverse();
          if (dates.length > 0) serverPredictions = store.predictions[dates[0]];
        }
      }
    } catch {}

    // 2) Haal odds op van API-Football (als key beschikbaar)
    let oddsMap: Record<string, any> = {};
    if (API_KEY) {
      try {
        const oddsRes = await fetch(`${API_BASE}/odds?date=${date}&bookmaker=6`, {
          headers: { 'x-apisports-key': API_KEY }
        });
        if (oddsRes.ok) {
          const oddsData = await oddsRes.json();
          for (const item of (oddsData.response || [])) {
            const fixtureId = item.fixture?.id;
            const market = item.bookmakers?.[0]?.bets?.find((b: any) => b.name === 'Match Winner');
            if (fixtureId && market) {
              oddsMap[fixtureId] = {
                home: market.values?.find((v: any) => v.value === 'Home')?.odd,
                draw: market.values?.find((v: any) => v.value === 'Draw')?.odd,
                away: market.values?.find((v: any) => v.value === 'Away')?.odd,
              };
            }
          }
        }
      } catch {}
    }

    // 3) Voeg odds toe aan voorspellingen
    const enriched = serverPredictions.map((p: any) => ({
      ...p,
      odds: oddsMap[p.matchId] || null
    }));

    return res.status(200).json({
      date,
      predictions: enriched,
      source: enriched.length > 0 ? 'server-data' : 'none',
    });

  } catch (err: any) {
    console.error('predict api error', err);
    res.status(500).json({ error: err?.message || 'unknown' });
  }
}
