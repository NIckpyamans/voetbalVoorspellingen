export const GOAL_QUARTER_KEYS = [
  "q1_0_15",
  "q2_16_30",
  "q3_31_45_plus",
  "q4_46_60",
  "q5_61_75",
  "q6_76_90_plus",
];

export function emptyGoalTimingBuckets() {
  return Object.fromEntries([...GOAL_QUARTER_KEYS, "unknown"].map((key) => [key, 0]));
}

export function goalQuarterFromMinute(value) {
  const match = String(value ?? "").match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
  if (!match) return "unknown";
  // Added time belongs to its regulation period: 45+2 is first half, 90+4
  // remains the final quarter.
  const minute = Number(match[1]);
  if (!Number.isFinite(minute)) return "unknown";
  if (minute <= 15) return "q1_0_15";
  if (minute <= 30) return "q2_16_30";
  if (minute <= 45) return "q3_31_45_plus";
  if (minute <= 60) return "q4_46_60";
  if (minute <= 75) return "q5_61_75";
  return "q6_76_90_plus";
}

export function normalizeGoalTimingBuckets(value) {
  const buckets = emptyGoalTimingBuckets();
  for (const key of Object.keys(buckets)) {
    const count = Number(value?.[key] || 0);
    buckets[key] = Number.isFinite(count) && count > 0 ? count : 0;
  }
  return buckets;
}

export function extractGoalTimingFromMatch(match, side) {
  const fromStats = match?.postMatchStats?.goalQuarters?.[side];
  if (fromStats && typeof fromStats === "object") return normalizeGoalTimingBuckets(fromStats);

  const buckets = emptyGoalTimingBuckets();
  const events = [
    ...(Array.isArray(match?.goalEvents) ? match.goalEvents : []),
    ...(Array.isArray(match?.incidents) ? match.incidents : []),
    ...(Array.isArray(match?.timeline) ? match.timeline : []),
  ];
  for (const event of events) {
    const type = String(event?.incidentType || event?.type || event?.strTimeline || "").toLowerCase();
    if (!type.includes("goal")) continue;
    const eventSide = event?.isHome === true || String(event?.side || "").toLowerCase() === "home"
      ? "home"
      : event?.isHome === false || String(event?.side || "").toLowerCase() === "away"
        ? "away"
        : null;
    if (eventSide !== side) continue;
    const bucket = goalQuarterFromMinute(event?.time ?? event?.minute ?? event?.displayTime ?? event?.intTime ?? event?.strTime);
    buckets[bucket] += 1;
  }
  return buckets;
}

function addBuckets(target, source) {
  for (const key of Object.keys(target)) target[key] += Number(source?.[key] || 0);
}

function totalKnown(buckets) {
  return GOAL_QUARTER_KEYS.reduce((sum, key) => sum + Number(buckets?.[key] || 0), 0);
}

export function summarizeGoalTiming(recentMatches = [], fallbackScoringProfile = null) {
  const scored = emptyGoalTimingBuckets();
  const conceded = emptyGoalTimingBuckets();
  for (const match of recentMatches || []) {
    addBuckets(scored, normalizeGoalTimingBuckets(match?.goalQuartersFor));
    addBuckets(conceded, normalizeGoalTimingBuckets(match?.goalQuartersAgainst));
  }
  if (!totalKnown(scored) && fallbackScoringProfile) addBuckets(scored, normalizeGoalTimingBuckets(fallbackScoringProfile));

  const scoredGoals = totalKnown(scored);
  const concededGoals = totalKnown(conceded);
  const ratio = (value, total) => total > 0 ? Number((value / total).toFixed(3)) : 0;
  const firstHalfScored = scored.q1_0_15 + scored.q2_16_30 + scored.q3_31_45_plus;
  const lateScored = scored.q5_61_75 + scored.q6_76_90_plus;
  const firstHalfConceded = conceded.q1_0_15 + conceded.q2_16_30 + conceded.q3_31_45_plus;
  const lateConceded = conceded.q5_61_75 + conceded.q6_76_90_plus;

  return {
    scored,
    conceded,
    scoredGoals,
    concededGoals,
    firstHalfScoringShare: ratio(firstHalfScored, scoredGoals),
    lateScoringShare: ratio(lateScored, scoredGoals),
    firstHalfConcedingShare: ratio(firstHalfConceded, concededGoals),
    lateConcedingShare: ratio(lateConceded, concededGoals),
    reliability: Number((Math.min(1, (scoredGoals + concededGoals) / 20)).toFixed(3)),
  };
}
