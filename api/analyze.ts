// api/analyze.ts — Claude AI analyse per wedstrijd
// Gebruikt Anthropic claude-sonnet-4-20250514 om Nederlandse matchanalyse te schrijven

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600'); // 1 uur cache

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST toegestaan' });
  }

  try {
    const { match, prediction } = req.body;
    if (!match || !prediction) {
      return res.status(400).json({ error: 'match en prediction zijn verplicht' });
    }

    // Bouw een rijke prompt op basis van alle beschikbare data
    const h2h = match.h2h;
    const homeForm = prediction.homeForm || match.homeForm || '';
    const awayForm = prediction.awayForm || match.awayForm || '';

    const prompt = `Je bent een professionele voetbalanalist. Analyseer deze wedstrijd in het Nederlands in maximaal 3 korte zinnen (max 120 woorden totaal). Wees direct en specifiek.

Wedstrijd: ${match.homeTeamName} vs ${match.awayTeamName}
Competitie: ${match.league}
${match.kickoff ? `Aftrap: ${new Date(match.kickoff).toLocaleString('nl-NL')}` : ''}

AI Model voorspelling:
- Score: ${prediction.predHomeGoals}-${prediction.predAwayGoals}
- Kansen: Thuis ${(prediction.homeProb*100).toFixed(0)}% | Gelijk ${(prediction.drawProb*100).toFixed(0)}% | Uit ${(prediction.awayProb*100).toFixed(0)}%
- Verwachte doelpunten: ${match.homeTeamName} ${prediction.homeXG} xG | ${match.awayTeamName} ${prediction.awayXG} xG
- Over 2.5 doelpunten: ${((prediction.over25||0)*100).toFixed(0)}%
- Beide scoren: ${((prediction.btts||0)*100).toFixed(0)}%

Teamdata:
- ${match.homeTeamName}: Elo ${prediction.homeElo || match.homeElo || '~'}, Vorm ${homeForm || 'onbekend'}${match.homeSeasonStats?.possession ? `, Balbezit ${match.homeSeasonStats.possession}%` : ''}${match.homeSeasonStats?.shotsOn ? `, ${match.homeSeasonStats.shotsOn} schoten op doel/wedstrijd` : ''}
- ${match.awayTeamName}: Elo ${prediction.awayElo || match.awayElo || '~'}, Vorm ${awayForm || 'onbekend'}${match.awaySeasonStats?.possession ? `, Balbezit ${match.awaySeasonStats.possession}%` : ''}${match.awaySeasonStats?.shotsOn ? `, ${match.awaySeasonStats.shotsOn} schoten op doel/wedstrijd` : ''}

${h2h && h2h.played >= 2 ? `Onderlinge duels (laatste ${h2h.played}): Thuis ${h2h.homeWins}W-${h2h.draws}G-${h2h.awayWins}V
Recente ontmoetingen: ${h2h.results.slice(-3).reverse().map((r: any) => `${r.home} ${r.score} ${r.away}`).join(' | ')}` : ''}

Schrijf een directe analyse in 3 zinnen. Begin met de favoriete uitkomst, noem een opvallende statistiek, en eindig met een concrete wedtip.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(200).json({ analysis: null, error: `Claude API fout: ${response.status}` });
    }

    const data = await response.json();
    const analysis = data.content?.[0]?.text || null;

    return res.status(200).json({ analysis, matchId: match.id });

  } catch (err: any) {
    console.error('[analyze] fout:', err);
    return res.status(200).json({ analysis: null, error: err?.message });
  }
}
