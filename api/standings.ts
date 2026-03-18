const GITHUB_RAW =
  process.env.DATA_URL ||
  "https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=60");

  try {
    const response = await fetch(`${GITHUB_RAW}?t=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
    });

    if (!response.ok) {
      return res.status(200).json({
        standings: {},
        knockoutOverview: {},
        error: `GitHub ${response.status}`,
      });
    }

    const store = await response.json();
    return res.status(200).json({
      standings: store.standings || {},
      knockoutOverview: store.knockoutOverview || {},
      lastRun: store.lastRun || null,
      workerVersion: store.workerVersion || "unknown",
    });
  } catch (err: any) {
    return res.status(200).json({
      standings: {},
      knockoutOverview: {},
      error: err?.message || "Unknown error",
    });
  }
}
