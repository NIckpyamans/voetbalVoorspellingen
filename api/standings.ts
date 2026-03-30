import { fetchServerStore } from "./_dataSource";

function buildCupSheetsFromMatches(store: any) {
  const sheets: Record<string, any> = {};
  const allMatches = Object.values(store.matches || {}).flat() as any[];

  for (const match of allMatches) {
    const isCupLike =
      match.aggregate?.active ||
      String(match.context?.summary || "").includes("knock-out") ||
      String(match.league || "").includes("Champions League") ||
      String(match.league || "").includes("Europa League") ||
      String(match.league || "").includes("Conference League") ||
      String(match.league || "").includes("Beker");

    if (!isCupLike) continue;

    const league = match.league || "Bekertoernooi";
    const round = String(match.roundLabel || "Knock-out");
    if (!sheets[league]) sheets[league] = { league, rounds: {} };
    if (!sheets[league].rounds[round]) sheets[league].rounds[round] = [];

    sheets[league].rounds[round].push({
      league,
      roundLabel: match.roundLabel || null,
      stakes: match.context?.stakes || match.context?.summary || null,
      matchId: match.id,
      kickoff: match.kickoff || null,
      homeTeamName: match.homeTeamName,
      awayTeamName: match.awayTeamName,
      aggregate: match.aggregate || null,
      score: match.score || null,
      status: match.status || "NS",
    });
  }

  return sheets;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=60");

  try {
    const { store, branch } = await fetchServerStore();
    const cupSheets =
      Object.keys(store.cupSheets || {}).length > 0
        ? store.cupSheets
        : buildCupSheetsFromMatches(store);

    return res.status(200).json({
      standings: store.standings || {},
      knockoutOverview: store.knockoutOverview || {},
      cupSheets,
      lastRun: store.lastRun || null,
      workerVersion: store.workerVersion || "unknown",
      reviewCount: Object.keys(store.postMatchReviews || {}).length,
      teamLearningCount: Object.keys(store.teamLearning || {}).length,
      sourceBranch: branch,
    });
  } catch (err: any) {
    return res.status(200).json({
      standings: {},
      knockoutOverview: {},
      cupSheets: {},
      error: err?.message || "Unknown error",
    });
  }
}
