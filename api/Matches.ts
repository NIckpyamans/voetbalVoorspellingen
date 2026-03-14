// api/Matches.ts
// Haalt wedstrijden op via API-Football (gratis tier, geen CORS probleem)
// API key staat veilig als omgevingsvariabele in Vercel

const API_BASE = "https://v3.football.api-sports.io";

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120');

  const API_KEY = process.env.FOOTBALL_API_KEY;
  if (!API_KEY) {
    return res.status(200).json({ events: [], error: 'API key niet ingesteld in Vercel omgevingsvariabelen' });
  }

  try {
    const { date, live } = req.query;

    let url: string;
    if (live === 'true') {
      url = `${API_BASE}/fixtures?live=all`;
    } else if (date) {
      url = `${API_BASE}/fixtures?date=${date}`;
    } else {
      const today = new Date().toISOString().split('T')[0];
      url = `${API_BASE}/fixtures?date=${today}`;
    }

    const response = await fetch(url, {
      headers: {
        'x-apisports-key': API_KEY,
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      return res.status(200).json({ events: [], error: `API-Football: ${response.status}` });
    }

    const data = await response.json();

    // Vertaal API-Football formaat naar ons eigen formaat
    const events = (data.response || []).map((item: any) => {
      const fixture = item.fixture;
      const teams = item.teams;
      const goals = item.goals;
      const league = item.league;
      const score = item.score;
      const odds = item.odds;

      // Status vertaling
      const statusCode = fixture?.status?.short || 'NS';
      let statusStr = 'NS';
      if (statusCode === 'FT' || statusCode === 'AET' || statusCode === 'PEN') statusStr = 'FT';
      else if (['1H', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(statusCode)) statusStr = 'LIVE';
      else statusStr = statusCode;

      const homeGoals = goals?.home;
      const awayGoals = goals?.away;
      const scoreStr = (homeGoals !== null && awayGoals !== null && homeGoals !== undefined && awayGoals !== undefined)
        ? `${homeGoals}-${awayGoals}` : 'v';

      return {
        id: fixture?.id,
        homeTeam: { 
          id: teams?.home?.id, 
          name: teams?.home?.name,
          logo: teams?.home?.logo
        },
        awayTeam: { 
          id: teams?.away?.id, 
          name: teams?.away?.name,
          logo: teams?.away?.logo
        },
        homeScore: { current: homeGoals },
        awayScore: { current: awayGoals },
        status: {
          type: statusCode === 'FT' ? 'finished' : statusCode === 'NS' ? 'notstarted' : 'inprogress',
          description: statusStr
        },
        time: { current: fixture?.status?.elapsed },
        startTimestamp: fixture?.timestamp,
        tournament: {
          name: league?.name,
          category: { name: league?.country }
        },
        score: scoreStr,
        // Kansen van bookmakers (voor AI voorspelling)
        odds: {
          home: item.odds?.[0]?.values?.find((v: any) => v.value === 'Home')?.odd || null,
          draw: item.odds?.[0]?.values?.find((v: any) => v.value === 'Draw')?.odd || null,
          away: item.odds?.[0]?.values?.find((v: any) => v.value === 'Away')?.odd || null,
        }
      };
    });

    return res.status(200).json({ events });

  } catch (err: any) {
    console.error('matches proxy error:', err);
    return res.status(200).json({ events: [], error: err?.message });
  }
}
