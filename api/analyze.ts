// api/analyze.ts — AI analyse via Groq (gratis, geen creditcard nodig)
// Model: llama-3.3-70b-versatile via console.groq.com

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Alleen POST' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      analysis: null,
      error: 'GROQ_API_KEY niet ingesteld — zie Instellingen voor uitleg'
    });
  }

  try {
    const { match, prediction } = req.body;
    if (!match || !prediction) {
      return res.status(400).json({ error: 'match en prediction verplicht' });
    }

    const h2h     = match.h2h || prediction.h2h;
    const homeInj = match.homeInjuries;
    const awayInj = match.awayInjuries;

    const prompt = `Je bent een professionele Nederlandse voetbalanalist. Schrijf precies 3 zinnen analyse. Gebruik de cijfers direct, geen inleidingen.

WEDSTRIJD: ${match.homeTeamName}${match.homePos ? ` (#${match.homePos})` : ''} vs ${match.awayTeamName}${match.awayPos ? ` (#${match.awayPos})` : ''}
COMPETITIE: ${match.league}
${match.kickoff ? `AFTRAP: ${new Date(match.kickoff).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}

MODEL VOORSPELLING: ${prediction.predHomeGoals}-${prediction.predAwayGoals}
KANSEN: Thuis ${(prediction.homeProb*100).toFixed(0)}% | Gelijk ${(prediction.drawProb*100).toFixed(0)}% | Uit ${(prediction.awayProb*100).toFixed(0)}%
xG: ${(prediction.homeXG||0).toFixed(2)} - ${(prediction.awayXG||0).toFixed(2)}
Over 2.5: ${((prediction.over25||0)*100).toFixed(0)}% | BTTS: ${((prediction.btts||0)*100).toFixed(0)}%
${match.matchImportance > 1.05 ? `BELANG: Cruciaal duel (factor ${match.matchImportance})` : ''}

TEAMS:
- ${match.homeTeamName}: Elo ${prediction.homeElo||'?'}, vorm ${prediction.homeForm||'onbekend'}${match.homeSeasonStats?.avgPossession ? `, balbezit ${match.homeSeasonStats.avgPossession}%` : ''}${match.homeSeasonStats?.avgShotsOn ? `, ${match.homeSeasonStats.avgShotsOn} schoten/wedstrijd` : ''}
- ${match.awayTeamName}: Elo ${prediction.awayElo||'?'}, vorm ${prediction.awayForm||'onbekend'}${match.awaySeasonStats?.avgPossession ? `, balbezit ${match.awaySeasonStats.avgPossession}%` : ''}${match.awaySeasonStats?.avgShotsOn ? `, ${match.awaySeasonStats.avgShotsOn} schoten/wedstrijd` : ''}
${homeInj?.injuredCount > 0 ? `BLESSURES ${match.homeTeamName.split(' ')[0].toUpperCase()}: ${homeInj.injuredCount} geblesseerd${homeInj.keyPlayersMissing?.length ? ` (${homeInj.keyPlayersMissing.join(', ')})` : ''}` : ''}
${awayInj?.injuredCount > 0 ? `BLESSURES ${match.awayTeamName.split(' ')[0].toUpperCase()}: ${awayInj.injuredCount} geblesseerd${awayInj.keyPlayersMissing?.length ? ` (${awayInj.keyPlayersMissing.join(', ')})` : ''}` : ''}
${h2h?.played >= 2 ? `H2H (${h2h.played} duels): Thuis ${h2h.homeWins}W-${h2h.draws}G-${h2h.awayWins}V | ${h2h.results.slice(-2).reverse().map((r: any) => `${r.home} ${r.score} ${r.away}`).join(' | ')}` : ''}

Schrijf PRECIES 3 zinnen in het Nederlands:
Zin 1: Favoriete uitkomst met onderbouwing (vorm + Elo).
Zin 2: Opvallende statistiek of blessure-impact die de uitkomst beïnvloedt.
Zin 3: Concrete wedtip (bijv. "Tip: Thuis wint + Over 2.5" of "Tip: BTTS Ja").`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 300,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: 'Je bent een professionele voetbalanalist. Je schrijft altijd precies 3 zinnen in het Nederlands. Gebruik data direct zonder inleidingen.'
          },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[analyze] Groq fout:', response.status, errText);
      return res.status(200).json({ analysis: null, error: `Groq API fout ${response.status}` });
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content?.trim() || null;

    return res.status(200).json({ analysis, matchId: match.id });

  } catch (err: any) {
    console.error('[analyze] onverwachte fout:', err);
    return res.status(200).json({ analysis: null, error: err?.message });
  }
}
