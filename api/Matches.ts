const GITHUB_RAW =
  process.env.DATA_URL ||
  "https://raw.githubusercontent.com/NIckpyamans/voetbalVoorspellingen/main/server_data.json";

export default async function handler(req: any, res: any) {
  const { date, live } = req.query;
  const today = new Date().toISOString().split("T")[0];
  const targetDate = typeof date === "string" && date ? date : today;
  const isLiveSensitiveRequest = targetDate === today || live === "true";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Cache-Control",
    isLiveSensitiveRequest ? "no-store" : "s-maxage=120, stale-while-revalidate=60"
  );

  try {
    const ghRes = await fetch(`${GITHUB_RAW}?t=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
    });

    if (!ghRes.ok) {
      return res.status(200).json({
        events: [],
        matches: [],
        lastRun: null,
        error: `GitHub ${ghRes.status}`,
      });
    }

    const store = await ghRes.json();
    const lastRun = store.lastRun || null;

    if (store.matches?.[targetDate]) {
      let matches = store.matches[targetDate];

      if (live === "true") {
        matches = matches.filter((m: any) => String(m.status || "").toUpperCase() === "LIVE");
      }

      return res.status(200).json({
        matches,
        events: matches,
        total: matches.length,
        date: targetDate,
        lastRun,
        source: "github-worker-v7",
      });
    }

    return res.status(200).json({
      matches: [],
      events: [],
      total: 0,
      date: targetDate,
      lastRun,
      source: "no-matches-yet",
      message: "Worker nog niet gedraaid met nieuwe code.",
    });
  } catch (err: any) {
    console.error("[Matches]", err);
    return res.status(200).json({
      matches: [],
      events: [],
      lastRun: null,
      error: err?.message || "Unknown error",
    });
  }
}
