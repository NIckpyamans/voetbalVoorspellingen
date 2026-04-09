import { fetchServerStore } from "./_dataSource.js";
import fs from "fs";
import path from "path";

function readBiweeklyDigest() {
  try {
    const digestPath = path.join(process.cwd(), "monitor", "biweekly-review-digest.json");
    if (!fs.existsSync(digestPath)) return null;
    return JSON.parse(fs.readFileSync(digestPath, "utf-8"));
  } catch {
    return null;
  }
}

function attachReview(match: any, store: any) {
  return {
    ...match,
    review: store.postMatchReviews?.[match.id] || null,
    learningSummary: match.learningSummary || null,
    marketCalibration: match.marketCalibration || null,
  };
}

export default async function handler(req: any, res: any) {
  const { date, live, days } = req.query;
  const today = new Date().toISOString().split("T")[0];
  const targetDate = typeof date === "string" && date ? date : today;
  const isLiveSensitiveRequest = targetDate === today || live === "true";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Cache-Control",
    isLiveSensitiveRequest ? "no-store" : "s-maxage=120, stale-while-revalidate=60"
  );

  try {
    const { store, branch } = await fetchServerStore();
    const lastRun = store.lastRun || null;
    const biweeklyDigest = readBiweeklyDigest();

    if (days && typeof days === "string") {
      const numDays = parseInt(days, 10);
      if (!isNaN(numDays) && numDays > 0 && numDays <= 7) {
        const multiDayMatches: any[] = [];
        const requestedDate = new Date(targetDate);

        for (let i = -Math.floor(numDays / 2); i <= Math.floor(numDays / 2); i++) {
          const checkDate = new Date(requestedDate);
          checkDate.setDate(checkDate.getDate() + i);
          const dateStr = checkDate.toISOString().split("T")[0];
          const dayMatches = (store.matches?.[dateStr] || []).map((match: any) => attachReview(match, store));
          multiDayMatches.push(...dayMatches);
        }

        return res.status(200).json({
          matches: multiDayMatches,
          events: multiDayMatches,
          total: multiDayMatches.length,
          date: targetDate,
          dateRange: `${numDays} dagen`,
          lastRun,
          workerVersion: store.workerVersion || "unknown",
          reviewCount: Object.keys(store.postMatchReviews || {}).length,
          teamLearningCount: Object.keys(store.teamLearning || {}).length,
          aiAdvice: store.aiAdvice || [],
          biweeklyDigest,
          sourceBranch: branch,
          source: "github-worker-v3-multiday",
        });
      }
    }

    const baseMatches = (store.matches?.[targetDate] || []).map((match: any) => attachReview(match, store));
    const matches = live === "true"
      ? baseMatches.filter((m: any) => String(m.status || "").toUpperCase() === "LIVE")
      : baseMatches;

    return res.status(200).json({
      matches,
      events: matches,
      total: matches.length,
      date: targetDate,
      lastRun,
      workerVersion: store.workerVersion || "unknown",
      reviewCount: Object.keys(store.postMatchReviews || {}).length,
      teamLearningCount: Object.keys(store.teamLearning || {}).length,
      aiAdvice: store.aiAdvice || [],
      biweeklyDigest,
      sourceBranch: branch,
      source: matches.length ? "github-worker-v3" : "no-matches-yet",
      message: matches.length ? null : "Nog geen wedstrijden gevonden voor deze dag in de actuele workerdata.",
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

