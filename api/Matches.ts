// api/matches.ts
// Server-side proxy voor SofaScore — voorkomt CORS blokkade in de browser

const SOFA = "https://api.sofascore.com/api/v1";

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60'); // 1 minuut cache

  try {
    const { date, live } = req.query;

    let url: string;
    if (live === 'true') {
      url = `${SOFA}/sport/football/events/live`;
    } else if (date) {
      url = `${SOFA}/sport/football/scheduled-events/${date}`;
    } else {
      return res.status(400).json({ error: 'Geef date of live=true mee' });
    }

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.sofascore.com/',
      }
    });

    if (!response.ok) {
      return res.status(200).json({ events: [], error: `SofaScore: ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err: any) {
    console.error('matches proxy error:', err);
    return res.status(200).json({ events: [], error: err?.message });
  }
}
