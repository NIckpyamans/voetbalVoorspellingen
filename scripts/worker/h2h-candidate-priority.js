function hasH2H(match) {
  return Number(match?.h2h?.played || match?.h2h?.results?.length || match?.played || 0) > 0;
}

export function orderH2HCandidatesByLastAttempt(candidates, attemptLedger = {}) {
  return [...(candidates || [])].sort((left, right) => {
    const leftHasH2H = hasH2H(left) ? 1 : 0;
    const rightHasH2H = hasH2H(right) ? 1 : 0;
    if (leftHasH2H !== rightHasH2H) return leftHasH2H - rightHasH2H;
    const leftKickoff = String(left?.kickoff_at || left?.date_key || "9999-12-31");
    const rightKickoff = String(right?.kickoff_at || right?.date_key || "9999-12-31");
    const leftCheckedAt = Date.parse(attemptLedger[left?.match_id]?.checkedAt || "") || 0;
    const rightCheckedAt = Date.parse(attemptLedger[right?.match_id]?.checkedAt || "") || 0;
    return leftKickoff.localeCompare(rightKickoff) || leftCheckedAt - rightCheckedAt;
  });
}

export function orderH2HCandidatesByCompetition(candidates, attemptLedger = {}) {
  const ordered = orderH2HCandidatesByLastAttempt(candidates, attemptLedger);
  const dateQueues = new Map();
  for (const candidate of ordered) {
    const date = String(candidate?.kickoff_at || candidate?.date_key || "9999-12-31").slice(0, 10);
    const league = String(candidate?.league || "unknown");
    if (!dateQueues.has(date)) dateQueues.set(date, new Map());
    const queues = dateQueues.get(date);
    if (!queues.has(league)) queues.set(league, []);
    queues.get(league).push(candidate);
  }
  const result = [];
  for (const date of [...dateQueues.keys()].sort()) {
    const queues = dateQueues.get(date);
    while ([...queues.values()].some((queue) => queue.length)) {
      for (const queue of queues.values()) {
        if (queue.length) result.push(queue.shift());
      }
    }
  }
  return result;
}
