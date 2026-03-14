// api/Matches.ts - Europese wedstrijden via SofaScore (gratis, geen API key)
// Gefilterd op Europa, met betere headers om blokkade te voorkomen

const EUROPEAN_COUNTRIES = new Set([
  'england','spain','italy','germany','france','netherlands','portugal',
  'belgium','scotland','turkey','switzerland','austria','greece','sweden',
  'norway','denmark','poland','czech republic','romania','ukraine','serbia',
  'croatia','russia','hungary','slovakia','slovenia','ireland','wales','finland'
]);

function isEuropean(event: any): boolean {
  const category = (event?.tournament?.category?.name || '').toLowerCase();
  const tname = (event?.tournament?.name || '').toLowerCase();
  if (tname.includes('uefa') || tname.includes('champions') || 
      tname.includes('europa') || tname.includes('conference')) return true;
  for (const c of EUROPEAN_COUNTRIES) {
    if (category.includes(c) || tname.includes(c)) return true;
  }
  return false;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');

  try {
    const { date, live } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const targetDate = (date as string) || today;

    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Host': 'api.sofascore.com',
      'Origin': 'https://www.sofascore.com',
      'Pragma': 'no-cache',
      'Referer': 'https://www.sofascore.com/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    };

    let allEvents: any[] = [];
    let source = 'none';
    let sofaError = '';

    // Poging 1: SofaScore
    try {
      const url = live === 'true'
        ? 'https://api.sofascore.com/api/v1/sport/football/events/live'
        : `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${targetDate}`;

      const sofaRes = await fetch(url, { headers });
      
      if (sofaRes.ok) {
        const data = await sofaRes.json();
        allEvents = data.events || [];
        source = 'sofascore';
      } else {
        sofaError = `SofaScore HTTP ${sofaRes.status}`;
        
        // Poging 1b: andere SofaScore URL
        const url2 = live === 'true'
          ? 'https://www.sofascore.com/api/v1/sport/football/events/live'
          : `https://www.sofascore.com/api/v1/sport/football/scheduled-events/${targetDate}`;
        
        const sofaRes2 = await fetch(url2, { headers: {
          ...headers,
          'Host': 'www.sofascore.com',
          'Origin': 'https://www.sofascore.com',
        }});
        
        if (sofaRes2.ok) {
          const data2 = await sofaRes2.json();
          allEvents = data2.events || [];
          source = 'sofascore-www';
        }
      }
    } catch (e: any) {
      sofaError = e.message;
    }

    // Poging 2: football-data.org (gratis, Europese competities)
    if (allEvents.length === 0 && live !== 'true') {
      try {
        // Haal meerdere Europese competities op
        const competitions = ['PL','BL1','SA','PD','FL1','PPL','DED','BSA','CLI','CL','EL','EC'];
        const matchDay = new Date(targetDate);
        
        const promises = competitions.slice(0, 6).map(comp =>
          fetch(`https://api.football-data.org/v4/competitions/${comp}/matches?dateFrom=${targetDate}&dateTo=${targetDate}`, {
            headers: { 'X-Auth-Token': '' } // gratis zonder token voor beperkte data
          }).then(r => r.ok ? r.json() : { matches: [] }).catch(() => ({ matches: [] }))
        );
        
        const results = await Promise.all(promises);
        const fdMatches = results.flatMap(r => r.matches || []);
        
        if (fdMatches.length > 0) {
          allEvents = fdMatches.map((m: any) => ({
            id: m.id,
            homeTeam: { 
              id: m.homeTeam?.id, 
              name: m.homeTeam?.shortName || m.homeTeam?.name,
              logo: m.homeTeam?.crest
            },
            awayTeam: { 
              id: m.awayTeam?.id, 
              name: m.awayTeam?.shortName || m.awayTeam?.name,
              logo: m.awayTeam?.crest
            },
            homeScore: { current: m.score?.fullTime?.home ?? m.score?.halfTime?.home },
            awayScore: { current: m.score?.fullTime?.away ?? m.score?.halfTime?.away },
            status: {
              type: m.status === 'FINISHED' ? 'finished' : 
                    m.status === 'IN_PLAY' || m.status === 'PAUSED' ? 'inprogress' : 'notstarted',
              description: m.status
            },
            time: { current: m.minute || null },
            startTimestamp: m.utcDate ? new Date(m.utcDate).getTime() / 1000 : null,
            tournament: {
              name: m.competition?.name,
              category: { name: m.area?.name || 'Europe' }
            },
            score: (m.score?.fullTime?.home !== null && m.score?.fullTime?.away !== null &&
                    m.score?.fullTime?.home !== undefined)
              ? `${m.score.fullTime.home}-${m.score.fullTime.away}` : 'v'
          }));
          source = 'football-data';
        }
      } catch (e: any) {
        console.log('[matches] football-data fout:', e.message);
      }
    }

    // Filter op Europa (alleen voor SofaScore die alle landen geeft)
    const europeanEvents = source === 'sofascore' || source === 'sofascore-www'
      ? allEvents.filter(isEuropean)
      : allEvents; // football-data geeft al alleen Europa terug

    return res.status(200).json({
      events: europeanEvents,
      total: europeanEvents.length,
      totalAll: allEvents.length,
      date: targetDate,
      source,
      debug: sofaError || undefined
    });

  } catch (err: any) {
    console.error('[matches] kritieke fout:', err);
    return res.status(200).json({ events: [], error: err?.message });
  }
}
