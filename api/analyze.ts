function buildTemplateAnalysis(match: any, prediction: any) {
  const home = match.homeTeamName;
  const away = match.awayTeamName;
  const homeProb = Math.round((prediction.homeProb || 0) * 100);
  const drawProb = Math.round((prediction.drawProb || 0) * 100);
  const awayProb = Math.round((prediction.awayProb || 0) * 100);
  const homeXG = Number(prediction.homeXG || 0).toFixed(2);
  const awayXG = Number(prediction.awayXG || 0).toFixed(2);

  const fav =
    homeProb >= drawProb && homeProb >= awayProb
      ? `${home} is favoriet`
      : awayProb >= homeProb && awayProb >= drawProb
        ? `${away} is favoriet`
        : "gelijkspel ligt relatief dicht bij de topkans";

  const h2h = match.h2h || prediction.h2h;
  const homeRest = match.homeRestDays ?? prediction.homeRestDays;
  const awayRest = match.awayRestDays ?? prediction.awayRestDays;
  const weather = match.weather || prediction.weather;
  const lineup = match.lineupSummary || prediction.lineupSummary;
  const modelEdges = prediction.modelEdges || match.modelEdges;

  const signals: string[] = [];
  if (homeRest != null && awayRest != null) {
    const diff = Number(homeRest) - Number(awayRest);
    if (Math.abs(diff) >= 1.5) {
      signals.push(
        diff > 0
          ? `${home} heeft meer rust (${homeRest} tegen ${awayRest} dagen)`
          : `${away} heeft meer rust (${awayRest} tegen ${homeRest} dagen)`
      );
    }
  }
  if (weather?.riskLevel && weather.riskLevel !== "low") {
    signals.push(
      `het weer kan invloed hebben met ${weather.windSpeed ?? "?"} km/u wind en ${weather.precipitationProbability ?? "?"}% neerslagkans`
    );
  }
  if (lineup?.confirmed) signals.push("de bevestigde opstellingen zijn al meegenomen");
  if (h2h?.played >= 4) signals.push(`in de recente H2H staat het ${h2h.homeWins}-${h2h.draws}-${h2h.awayWins}`);
  if (modelEdges?.weatherRisk === "high") signals.push("de omstandigheden drukken waarschijnlijk het tempo");

  const signalSentence =
    signals.length > 0 ? signals.slice(0, 2).join(" en ") : "de kernsignalen komen uit vorm, Elo en thuis-uit splits";

  let tip = "BTTS Ja";
  if ((prediction.over25 || 0) >= 0.62) tip = "Over 2.5";
  if ((prediction.homeProb || 0) >= 0.56) tip = `${home} wint`;
  if ((prediction.awayProb || 0) >= 0.56) tip = `${away} wint`;

  return `${fav} met ${homeProb}%-${drawProb}%-${awayProb}% en een verwacht scorebeeld van ${prediction.predHomeGoals}-${prediction.predAwayGoals} op basis van ${homeXG}-${awayXG} xG. ${signalSentence}. Tip: ${tip}.`;
}

async function tryOllama(prompt: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || "gpt-oss:20b",
        prompt,
        stream: false,
        options: { temperature: 0.3 },
      }),
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    const text = String(data?.response || "").trim();
    return text || null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=1800");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST" });

  try {
    const { match, prediction } = req.body;
    if (!match || !prediction) {
      return res.status(400).json({ error: "match en prediction verplicht" });
    }

    const h2h = match.h2h || prediction.h2h;
    const homeInj = match.homeInjuries;
    const awayInj = match.awayInjuries;
    const weather = match.weather || prediction.weather;
    const lineup = match.lineupSummary || prediction.lineupSummary;

    const prompt = `Je bent een professionele Nederlandse voetbalanalist. Schrijf precies 3 zinnen, direct en concreet.
WEDSTRIJD: ${match.homeTeamName} vs ${match.awayTeamName}
COMPETITIE: ${match.league}
VOORSPELLING: ${prediction.predHomeGoals}-${prediction.predAwayGoals}
KANSEN: thuis ${(prediction.homeProb * 100).toFixed(0)}% | gelijk ${(prediction.drawProb * 100).toFixed(0)}% | uit ${(prediction.awayProb * 100).toFixed(0)}%
xG: ${(prediction.homeXG || 0).toFixed(2)} - ${(prediction.awayXG || 0).toFixed(2)}
OVER 2.5: ${((prediction.over25 || 0) * 100).toFixed(0)}%
BTTS: ${((prediction.btts || 0) * 100).toFixed(0)}%
THUIS VORM: ${prediction.homeForm || match.homeForm || "onbekend"}
UIT VORM: ${prediction.awayForm || match.awayForm || "onbekend"}
ELO: ${prediction.homeElo || "?"} - ${prediction.awayElo || "?"}
RUSTDAGEN: ${match.homeRestDays ?? prediction.homeRestDays ?? "?"} - ${match.awayRestDays ?? prediction.awayRestDays ?? "?"}
WEER: ${weather ? `${weather.temperature ?? "?"}C, wind ${weather.windSpeed ?? "?"}, regenkans ${weather.precipitationProbability ?? "?"}%` : "onbekend"}
LINEUPS BEVESTIGD: ${lineup?.confirmed ? "ja" : "nee"}
${homeInj?.injuredCount > 0 ? `BLESSURES THUIS: ${homeInj.injuredCount}` : ""}
${awayInj?.injuredCount > 0 ? `BLESSURES UIT: ${awayInj.injuredCount}` : ""}
${h2h?.played >= 2 ? `H2H: ${h2h.homeWins}-${h2h.draws}-${h2h.awayWins}` : ""}
Regels:
- Zin 1: verwachte uitkomst met onderbouwing
- Zin 2: belangrijkste extra signaal uit rust, weer, blessures, H2H of lineups
- Zin 3: concrete tip
- Nederlands
- geen intro of afsluiter`;

    const ollamaText = await tryOllama(prompt);
    const analysis = ollamaText || buildTemplateAnalysis(match, prediction);

    return res.status(200).json({
      analysis,
      engine: ollamaText ? "ollama-local" : "template-free",
      matchId: match.id,
    });
  } catch (err: any) {
    console.error("[analyze]", err);
    return res.status(200).json({ analysis: null, error: err?.message || "Unknown error" });
  }
}
