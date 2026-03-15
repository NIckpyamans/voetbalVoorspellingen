// api/Matches.ts — geeft matches + lastRun terug vanuit server_data.json op GitHub

const GITHUB_RAW = process.env.DATA_URL ||
  'https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30');

  try {
    const { date, live } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const targetDate = (date as string) || today;

    // Haal server_data.json op van GitHub
    const ghRes = await fetch(`${GITHUB_RAW}?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!ghRes.ok) {
      return res.status(200).json({ events: [], matches: [], lastRun: null, error: `GitHub ${ghRes.status}` });
    }

    const store = await ghRes.json();
    const lastRun = store.lastRun || null;

    // NIEUW formaat: store.matches[date]
    if (store.matches?.[targetDate]) {
      let matches = store.matches[targetDate];

      // Live filter
      if (live === 'true') {
        matches = matches.filter((m: any) => m.status === 'LIVE');
      }

      return res.status(200).json({
        matches,
        events: matches, // compatibiliteit
        total: matches.length,
        date: targetDate,
        lastRun,
        source: 'github-worker-v2'
      });
    }

    // OUD formaat: geen matches veld, geef lege array
    // De predictions worden apart opgehaald via /api/predict
    return res.status(200).json({
      matches: [],
      events: [],
      total: 0,
      date: targetDate,
      lastRun,
      source: 'no-matches-yet',
      message: 'Worker nog niet gedraaid met nieuwe code. Start de Football AI Worker via GitHub Actions.'
    });

  } catch (err: any) {
    console.error('[Matches]', err);
    return res.status(200).json({ matches: [], events: [], lastRun: null, error: err?.message });
  }
}
