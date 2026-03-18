const GITHUB_RAW_URL =
  process.env.DATA_URL ||
  "https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json";

function impliedOdds(prob: number | undefined) {
  const p = Number(prob || 0);
  if (!p || p <= 0.01) return null;
  return Number((1 / p).toFixed(2));
}

function buildDerivedOdds(prediction: any) {
  return {
    home: impliedOdds(prediction.homeProb),
    draw: impliedOdds(prediction.drawProb),
    away: impliedOdds(prediction.awayProb),
  };
}

function buildValueFlags(prediction: any) {
  const odds = prediction.odds || {};
  const derived = buildDerivedOdds(prediction);

  const compare = (modelProb: number, marketOdd?: number | string | null) => {
    const odd = Number(marketOdd);
    if (!Number.isFinite(odd) || odd <= 1.01) return null;
    const marketProb = 1 / odd;
    const edge = modelProb - marketProb;
    return {
      edge: Number(edge.toFixed(4)),
      edgePct: Number((edge * 100).toFixed(1)),
      value: edge >= 0.04,
    };
  };

  return {
    derived,
    home: compare(Number(prediction.homeProb || 0), odds.home),
    draw: compare(Number(prediction.drawProb || 0), odds.draw),
    away: compare(Number(prediction.awayProb || 0), odds.away),
  };
}

function enrichPrediction(prediction: any, matchMap: Record<string, any>) {
  const match = matchMap[prediction.matchId] || null;
  const odds = prediction.odds || null;

  return {
    ...prediction,
    odds,
    derivedOdds: buildDerivedOdds(prediction),
    valueFlags: buildValueFlags(prediction),
    weather: prediction.weather || match?.weather || null,
    lineupSummary: prediction.lineupSummary || match?.lineupSummary || null,
    h2h: prediction.h2h || match?.h2h || null,
    homeRestDays:
      prediction.homeRestDays != null ? prediction.homeRestDays : match?.homeRestDays ?? null,
    awayRestDays:
      prediction.awayRestDays != null ? prediction.awayRestDays : match?.awayRestDays ?? null,
    modelEdges: prediction.modelEdges || match?.modelEdges || null,
    match,
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "no-store");

  try {
    const date =
      (req.query?.date as string) || new Date().toISOString().split("T")[0];

    const response = await fetch(`${GITHUB_RAW_URL}?t=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
    });

    if (!response.ok) {
      return res.status(200).json({
        date,
        predictions: [],
        source: "none",
        error: `GitHub ${response.status}`,
      });
    }

    const store = await response.json();
    const serverPredictions: any[] = store.predictions?.[date] || [];
    const matches: any[] = store.matches?.[date] || [];
    const matchMap = Object.fromEntries(matches.map((match: any) => [match.id, match]));

    const enriched = serverPredictions.map((prediction: any) =>
      enrichPrediction(prediction, matchMap)
    );

    return res.status(200).json({
      date,
      predictions: enriched,
      total: enriched.length,
      source: enriched.length > 0 ? "server-data-v2" : "none",
      lastRun: store.lastRun || null,
    });
  } catch (err: any) {
    console.error("[predict]", err);
    return res.status(500).json({ error: err?.message || "unknown" });
  }
}
