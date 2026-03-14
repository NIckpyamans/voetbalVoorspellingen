// api/Matches.ts
// Leest wedstrijden uit server_data.json (opgeslagen door GitHub Actions worker)
// De worker draait op GitHub servers die SofaScore NIET blokkeren

const GITHUB_RAW = process.env.DATA_URL ||
  'https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30');

  try {
    const { date, live } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const targetDate = (date as string) || today;

    // Haal data op van GitHub (gratis, altijd beschikbaar)
    const ghRes = await fetch(`${GITHUB_RAW}?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!ghRes.ok) {
      return res.status(200).json({
        events: [],
        error: `GitHub fetch mislukt: ${ghRes.status}`,
        tip: 'Zorg dat de GitHub Actions worker heeft gedraaid'
      });
    }

    const store = await ghRes.json();

    let events: any[] = [];

    if (live === 'true') {
      // Live wedstrijden = wedstrijden van vandaag met status LIVE
      const todayMatches = store.matches?.[today] || [];
      events = todayMatches.filter((m: any) => m.status === 'LIVE');
    } else {
      // Wedstrijden voor gevraagde datum
      events = store.matches?.[targetDate] || [];
    }

    // Vertaal naar het formaat dat matchService verwacht
    const formatted = events.map((m: any) => ({
      id: m.sofaId || m.id?.replace('ss-', ''),
      homeTeam: {
        id: m.homeTeamId,
        name: m.homeTeamName,
        logo: m.homeLogo
      },
      awayTeam: {
        id: m.awayTeamId,
        name: m.awayTeamName,
        logo: m.awayLogo
      },
      homeScore: { current: m.score ? Number(m.score.split('-')[0]) : null },
      awayScore: { current: m.score ? Number(m.score.split('-')[1]) : null },
      status: {
        type: m.status === 'FT' ? 'finished' :
              m.status === 'LIVE' ? 'inprogress' : 'notstarted',
        description: m.status
      },
      time: { current: m.minute ? parseInt(m.minute) : null },
      startTimestamp: m.kickoff ? new Date(m.kickoff).getTime() / 1000 : null,
      tournament: {
        name: m.league?.split(' — ')[1] || m.league,
        category: { name: m.league?.split(' — ')[0] || '' }
      },
      score: m.score || 'v'
    }));

    return res.status(200).json({
      events: formatted,
      total: formatted.length,
      date: targetDate,
      lastRun: store.lastRun,
      source: 'github-worker'
    });

  } catch (err: any) {
    console.error('[matches] fout:', err);
    return res.status(200).json({ events: [], error: err?.message });
  }
}
