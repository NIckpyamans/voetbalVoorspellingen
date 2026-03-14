// api/Matches.ts
// Server-side proxy voor wedstrijden via API-Football (api-sports.io)

const API_BASE = "https://v3.football.api-sports.io";

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');

  const API_KEY = process.env.FOOTBALL_API_KEY;

  if (!API_KEY) {
    return res.status(200).json({ events: [], error: 'API key niet ingesteld' });
  }

  try {
    const { date, live } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const targetDate = date || today;

    // Eerst: check status van je account
    const statusRes = await fetch(`${API_BASE}/status`, {
      headers: {
        'x-apisports-key': API_KEY,
        'Accept': 'application/json',
      }
    });
    const statusData = await statusRes.json();
    
    // Als account niet geldig, geef nuttige foutmelding
    if (statusData?.errors?.token) {
      return res.status(200).json({ 
        events: [], 
        error: `API token fout: ${statusData.errors.token}`,
        accountInfo: statusData 
      });
    }

    let url: string;
    if (live === 'true') {
      url = `${API_BASE}/fixtures?live=all`;
    } else {
      url = `${API_BASE}/fixtures?date=${targetDate}&timezone=Europe/Amsterdam`;
    }

    const response = await fetch(url, {
      headers: {
        'x-apisports-key': API_KEY,
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      return res.status(200).json({ 
        events: [], 
        error: `API fout: ${response.status}`,
        accountStatus: statusData?.response
      });
    }

    const data = await response.json();

    // Geef ook account info mee voor debugging
    const accountInfo = statusData?.response;

    // Vertaal naar ons formaat
    const events = (data.response || []).map((item: any) => {
      const fixture = item.fixture;
      const teams = item.teams;
      const goals = item.goals;
      const league = item.league;

      const statusCode = fixture?.status?.short || 'NS';
      let statusType = 'notstarted';
      if (['FT','AET','PEN'].includes(statusCode)) statusType = 'finished';
      else if (['1H','2H','ET','BT','P','LIVE','HT'].includes(statusCode)) statusType = 'inprogress';

      const homeGoals = goals?.home;
      const awayGoals = goals?.away;
      const scoreStr = (homeGoals !== null && awayGoals !== null && 
                        homeGoals !== undefined && awayGoals !== undefined)
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
          type: statusType,
          description: statusCode
        },
        time: { current: fixture?.status?.elapsed },
        startTimestamp: fixture?.timestamp,
        tournament: {
          name: league?.name,
          category: { name: league?.country }
        },
        score: scoreStr,
      };
    });

    return res.status(200).json({ 
      events,
      total: events.length,
      date: targetDate,
      requestsUsed: accountInfo?.requests?.current,
      requestsLimit: accountInfo?.requests?.limit_day,
    });

  } catch (err: any) {
    console.error('matches proxy error:', err);
    return res.status(200).json({ events: [], error: err?.message });
  }
}
