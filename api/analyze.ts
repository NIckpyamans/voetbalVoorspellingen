// api/analyze.ts — Claude AI analyse per wedstrijd
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Alleen POST' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      analysis: null,
      error: 'ANTHROPIC_API_KEY niet ingesteld — zie Vercel → Settings → Environment Variables'
    });
  }

  try {
    const { match, prediction } = req.body;
    if (!match || !prediction) return res.status(400).json({ error: 'match en prediction verplicht' });

    const h2h     = match.h2h || prediction.h2h;
    const homeInj = match.homeInjuries;
    const awayInj = match.awayInjuries;

    const prompt = `Je bent een professionele voetbalanalist. Schrijf een analyse van precies 3 zinnen in het Nederlands. Wees direct en gebruik de cijfers.

Wedstrijd: ${match.homeTeamName}${match.homePos ? ` (#${match.homePos})` : ''} vs ${match.awayTeamName}${match.awayPos ? ` (#${match.awayPos})` : ''}
Competitie: ${match.league}
${match.kickoff ? `Aftrap: ${new Date(match.kickoff).toLocaleString('nl-NL', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}` : ''}

Model: ${prediction.predHomeGoals}-${prediction.predAwayGoals} | Thuis ${(prediction.homeProb*100).toFixed(0)}% | Gelijk ${(prediction.drawProb*100).toFixed(0)}% | Uit ${(prediction.awayProb*100).toFixed(0)}%
xG: ${(prediction.homeXG||0).toFixed(2)} - ${(prediction.awayXG||0).toFixed(2)} | Over 2.5: ${((prediction.over25||0)*100).toFixed(0)}% | BTTS: ${((prediction.btts||0)*100).toFixed(0)}%
${match.matchImportance > 1.05 ? `Belangrijk duel (factor ${match.matchImportance})` : ''}

${match.homeTeamName}: Elo ${prediction.homeElo||'?'}, vorm ${prediction.homeForm||'?'}${match.homeSeasonStats?.avgPossession ? `, bezit ${match.homeSeasonStats.avgPossession}%` : ''}
${match.awayTeamName}: Elo ${prediction.awayElo||'?'}, vorm ${prediction.awayForm||'?'}${match.awaySeasonStats?.avgPossession ? `, bezit ${match.awaySeasonStats.avgPossession}%` : ''}
${homeInj?.injuredCount > 0 ? `Geblesseerd ${match.homeTeamName.split(' ')[0]}: ${homeInj.injuredCount} spelers${homeInj.keyPlayersMissing?.length ? ` (${homeInj.keyPlayersMissing.join(', ')})` : ''}` : ''}
${awayInj?.injuredCount > 0 ? `Geblesseerd ${match.awayTeamName.split(' ')[0]}: ${awayInj.injuredCount} spelers${awayInj.keyPlayersMissing?.length ? ` (${awayInj.keyPlayersMissing.join(', ')})` : ''}` : ''}
${h2h?.played >= 2 ? `H2H: Thuis ${h2h.homeWins}W-${h2h.draws}G-${h2h.awayWins}V | ${h2h.results.slice(-2).reverse().map((r: any) => `${r.home} ${r.score} ${r.away}`).join(' | ')}` : ''}

Schrijf precies 3 zinnen: (1) favoriete uitkomst met onderbouwing, (2) opvallende statistiek of blessure-impact, (3) concrete wedtip.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',   // ← correcte model string
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[analyze] Anthropic fout:', response.status, errText);
      return res.status(200).json({ analysis: null, error: `Anthropic API fout ${response.status}` });
    }

    const data = await response.json();
    const analysis = data.content?.[0]?.text?.trim() || null;
    return res.status(200).json({ analysis, matchId: match.id });

  } catch (err: any) {
    console.error('[analyze] fout:', err);
    return res.status(200).json({ analysis: null, error: err?.message });
  }
}
