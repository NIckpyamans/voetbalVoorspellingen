function recentSummary(teamName: string, recent: any) {
  const form = recent?.form || "onbekend";
  const lastFive = (recent?.recentMatches || [])
    .map((item: any) => `${item.venue || "?"}${item.result || "?"} ${item.score || "-"}`)
    .join(" | ");
  const homeSplit = recent?.splits?.home;
  const awaySplit = recent?.splits?.away;
  const splitText =
    homeSplit || awaySplit
      ? `, thuis ${homeSplit ? `${homeSplit.avgScored}-${homeSplit.avgConceded}` : "-"}, uit ${awaySplit ? `${awaySplit.avgScored}-${awaySplit.avgConceded}` : "-"}`
      : "";
  return `${teamName}: vorm ${form}${splitText}${lastFive ? `, laatste 5 ${lastFive}` : ""}`;
}

function buildTemplateAnalysis(match: any, prediction: any) {
  const home = match.homeTeamName;
  const away = match.awayTeamName;
  const homeProb = Math.round((prediction.homeProb || 0) * 100);
  const drawProb = Math.round((prediction.drawProb || 0) * 100);
  const awayProb = Math.round((prediction.awayProb || 0) * 100);
  const homeXG = Number(prediction.homeXG || 0).toFixed(2);
  const awayXG = Number(prediction.awayXG || 0).toFixed(2);

  const favorite =
    homeProb >= drawProb && homeProb >= awayProb
      ? `${home} is favoriet`
      : awayProb >= homeProb && awayProb >= drawProb
        ? `${away} is favoriet`
        : "gelijkspel zit dicht bij de topkans";

  const signals: string[] = [];
  const context = match.context || prediction.context;
  const aggregate = match.aggregate || prediction.aggregate;
  const h2h = match.h2h || prediction.h2h;
  const weather = match.weather || prediction.weather;
  const lineup = match.lineupSummary || prediction.lineupSummary;

  if (context?.summary) signals.push(context.summary);
  if (aggregate?.active && aggregate.aggregateScore) signals.push(`aggregate ${aggregate.aggregateScore}`);
  if (h2h?.played >= 3) signals.push(`H2H ${h2h.homeWins}-${h2h.draws}-${h2h.awayWins}`);
  if (weather?.riskLevel && weather.riskLevel !== "low") {
    signals.push(`weerimpact ${weather.temperature ?? "?"}C en ${weather.precipitationProbability ?? "?"}% neerslagkans`);
  }
  if (lineup?.confirmed) signals.push("bevestigde opstellingen");
  if (match.homeRecent?.strongestSide === "home") signals.push(`${home} presteert sterker thuis`);
  if (match.awayRecent?.strongestSide === "away") signals.push(`${away} presteert sterker uit`);
  if (match.homeInjuries?.injuredCount) signals.push(`${home} mist ${match.homeInjuries.injuredCount} speler(s)`);
  if (match.awayInjuries?.injuredCount) signals.push(`${away} mist ${match.awayInjuries.injuredCount} speler(s)`);
  if (prediction.modelEdges?.clubEloDiff != null) {
    signals.push(`ClubElo edge ${prediction.modelEdges.clubEloDiff > 0 ? home : away}`);
  }
  if (prediction.modelEdges?.riskProfile) signals.push(`risico ${prediction.modelEdges.riskProfile}`);
  if (prediction.modelEdges?.modelAgreement != null) {
    signals.push(`model agreement ${Math.round(prediction.modelEdges.modelAgreement * 100)}%`);
  }
  if (prediction.modelEdges?.tacticalMismatch?.summary) signals.push(prediction.modelEdges.tacticalMismatch.summary);
  if (prediction.modelEdges?.formShift?.summary) signals.push(prediction.modelEdges.formShift.summary);
  if (match.homeTeamProfile?.setPieceScore || match.awayTeamProfile?.setPieceScore) {
    signals.push(`set-piece ${match.homeTeamProfile?.setPieceScore ?? "-"}-${match.awayTeamProfile?.setPieceScore ?? "-"}`);
  }
  if (prediction.modelEdges?.travelEdge?.summary) signals.push(prediction.modelEdges.travelEdge.summary);
  if (prediction.modelEdges?.keeperEdge?.summary) signals.push(prediction.modelEdges.keeperEdge.summary);
  if (prediction.modelEdges?.lineupImpact?.summary) signals.push(prediction.modelEdges.lineupImpact.summary);

  let tip = "BTTS Ja";
  if ((prediction.homeProb || 0) >= 0.55) tip = `${home} wint`;
  else if ((prediction.awayProb || 0) >= 0.55) tip = `${away} wint`;
  else if ((prediction.over25 || 0) >= 0.62) tip = "Over 2.5";

  const signalText = signals.length ? signals.slice(0, 3).join(", ") : "vorm, thuis-uit splits en modelkansen";

  return `${favorite} met ${homeProb}%-${drawProb}%-${awayProb}% en een verwacht scorebeeld van ${prediction.predHomeGoals}-${prediction.predAwayGoals} op basis van ${homeXG}-${awayXG} xG. Belangrijkste signalen: ${signalText}. Tip: ${tip}.`;
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
        options: { temperature: 0.25 },
      }),
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    return String(data?.response || "").trim() || null;
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
    const aggregate = match.aggregate || prediction.aggregate;
    const context = match.context || prediction.context;
    const weather = match.weather || prediction.weather;
    const lineup = match.lineupSummary || prediction.lineupSummary;

    const prompt = `Je bent een professionele Nederlandse voetbalanalist. Schrijf precies 3 zinnen, compact en concreet.
WEDSTRIJD: ${match.homeTeamName} vs ${match.awayTeamName}
COMPETITIE: ${match.league}
VOORSPELLING: ${prediction.predHomeGoals}-${prediction.predAwayGoals}
KANSEN: thuis ${(prediction.homeProb * 100).toFixed(0)}% | gelijk ${(prediction.drawProb * 100).toFixed(0)}% | uit ${(prediction.awayProb * 100).toFixed(0)}%
xG: ${(prediction.homeXG || 0).toFixed(2)} - ${(prediction.awayXG || 0).toFixed(2)}
OVER 2.5: ${((prediction.over25 || 0) * 100).toFixed(0)}%
BTTS: ${((prediction.btts || 0) * 100).toFixed(0)}%
THUIS VORM: ${prediction.homeForm || match.homeForm || "onbekend"}
UIT VORM: ${prediction.awayForm || match.awayForm || "onbekend"}
${recentSummary(match.homeTeamName, match.homeRecent)}
${recentSummary(match.awayTeamName, match.awayRecent)}
RUSTDAGEN: ${match.homeRestDays ?? prediction.homeRestDays ?? "?"} - ${match.awayRestDays ?? prediction.awayRestDays ?? "?"}
CLUB ELO: ${prediction.homeClubElo ?? match.homeClubElo ?? "?"} - ${prediction.awayClubElo ?? match.awayClubElo ?? "?"}
BLESSURES: ${match.homeInjuries?.injuredCount || 0} - ${match.awayInjuries?.injuredCount || 0}
STERKE KANT: ${match.homeTeamName} ${match.homeRecent?.strongestSide || "balanced"} | ${match.awayTeamName} ${match.awayRecent?.strongestSide || "balanced"}
MODEL: ${(prediction.ensembleMeta || match.ensembleMeta)?.active ? `${(prediction.ensembleMeta || match.ensembleMeta).baseModel} + ${(prediction.ensembleMeta || match.ensembleMeta).blendModel}` : "basis"}
RISICO: ${prediction.modelEdges?.riskProfile || "onbekend"}
AGREEMENT: ${prediction.modelEdges?.modelAgreement != null ? `${Math.round(prediction.modelEdges.modelAgreement * 100)}%` : "?"}
LINEUP IMPACT: ${prediction.modelEdges?.lineupImpact?.summary || "neutraal"}
TACTISCHE MISMATCH: ${prediction.modelEdges?.tacticalMismatch?.summary || "gebalanceerd"}
FORM SHIFT: ${prediction.modelEdges?.formShift?.summary || "stabiel"}
SET PIECE: ${match.homeTeamProfile?.setPieceScore ?? "?"} - ${match.awayTeamProfile?.setPieceScore ?? "?"}
HOEKEN: ${match.homeTeamProfile?.cornersTrend ?? "?"} - ${match.awayTeamProfile?.cornersTrend ?? "?"}
KAARTEN: ${match.homeRecent?.yellowCardRate ?? "?"} - ${match.awayRecent?.yellowCardRate ?? "?"}
KEEPER EDGE: ${prediction.modelEdges?.keeperEdge?.summary || "onbekend"}
TRAVEL: ${prediction.modelEdges?.travelEdge?.summary || "beperkt"}
CONTINUITY: ${prediction.modelEdges?.lineupImpact?.homeContinuity ?? "?"} - ${prediction.modelEdges?.lineupImpact?.awayContinuity ?? "?"}
WEER: ${weather ? `${weather.temperature ?? "?"}C, wind ${weather.windSpeed ?? "?"}, regenkans ${weather.precipitationProbability ?? "?"}%` : "onbekend"}
LINEUPS: ${lineup?.confirmed ? "bevestigd" : "open"}
${h2h?.played >= 2 ? `H2H: ${h2h.homeWins}-${h2h.draws}-${h2h.awayWins}` : ""}
${aggregate?.active ? `TWEELUIK: eerste duel ${aggregate.firstLegScore || "?"}, aggregate ${aggregate.aggregateScore || "?"}` : ""}
${context?.summary ? `CONTEXT: ${context.summary}` : ""}
Regels:
- Zin 1: uitkomst met onderbouwing
- Zin 2: vorm/context/tweeluik of H2H
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
