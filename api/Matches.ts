// api/Matches.ts
// Haalt wedstrijden op via meerdere gratis bronnen (geen API key)
// Probeert SofaScore eerst, dan OpenLigaDB als fallback

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120');

  try {
    const { date, live } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const targetDate = (date as string) || today;

    // Browser-achtige headers om blokkade te voorkomen
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://www.sofascore.com/',
      'Origin': 'https://www.sofascore.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
    };

    let events: any[] = [];
    let source = 'none';

    // Poging 1: SofaScore
    try {
      const url = live === 'true'
        ? 'https://api.sofascore.com/api/v1/sport/football/events/live'
        : `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${targetDate}`;

      const res1 = await fetch(url, { headers });

      if (res1.ok) {
        const data = await res1.json();
        events = data.events || [];
        source = 'sofascore';
      } else {
        console.log('[matches] SofaScore status:', res1.status);
      }
    } catch (e: any) {
      console.log('[matches] SofaScore fout:', e.message);
    }

    // Poging 2: TheSportsDB (100% gratis, geen key)
    if (events.length === 0 && live !== 'true') {
      try {
        const [year, month, day] = targetDate.split('-');
        const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${year}-${month}-${day}&s=Soccer`;
        const res2 = await fetch(url, {
          headers: { 'Accept': 'application/json' }
        });

        if (res2.ok) {
          const data = await res2.json();
          const rawEvents = data.events || [];

          // Vertaal TheSportsDB formaat naar ons formaat
          events = rawEvents.map((e: any) => ({
            id: e.idEvent,
            homeTeam: {
              id: e.idHomeTeam,
              name: e.strHomeTeam,
              logo: e.strHomeTeamBadge || `https://www.thesportsdb.com/images/media/team/badge/${e.idHomeTeam}.png`
            },
            awayTeam: {
              id: e.idAwayTeam,
              name: e.strAwayTeam,
              logo: e.strAwayTeamBadge || `https://www.thesportsdb.com/images/media/team/badge/${e.idAwayTeam}.png`
            },
            homeScore: { current: e.intHomeScore ? Number(e.intHomeScore) : null },
            awayScore: { current: e.intAwayScore ? Number(e.intAwayScore) : null },
            status: {
              type: e.strStatus === 'Match Finished' ? 'finished' : 
                    e.strStatus === 'In Progress' ? 'inprogress' : 'notstarted',
              description: e.strStatus || 'NS'
            },
            time: { current: null },
            startTimestamp: e.strTimestamp ? new Date(e.strTimestamp).getTime() / 1000 : null,
            tournament: {
              name: e.strLeague,
              category: { name: e.strCountry || e.strLeague }
            },
            score: (e.intHomeScore !== null && e.intAwayScore !== null && 
                    e.intHomeScore !== '' && e.intAwayScore !== '')
              ? `${e.intHomeScore}-${e.intAwayScore}` : 'v',
          }));

          source = 'thesportsdb';
        }
      } catch (e: any) {
        console.log('[matches] TheSportsDB fout:', e.message);
      }
    }

    return res.status(200).json({
      events,
      total: events.length,
      date: targetDate,
      source
    });

  } catch (err: any) {
    console.error('[matches] kritieke fout:', err);
    return res.status(200).json({ events: [], error: err?.message });
  }
}
