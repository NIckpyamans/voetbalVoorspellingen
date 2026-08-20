export function orderH2HCandidatesByLastAttempt(candidates, attemptLedger = {}) {
  return [...(candidates || [])].sort((left, right) => {
    const leftCheckedAt = Date.parse(attemptLedger[left?.match_id]?.checkedAt || "") || 0;
    const rightCheckedAt = Date.parse(attemptLedger[right?.match_id]?.checkedAt || "") || 0;
    return leftCheckedAt - rightCheckedAt || String(left?.kickoff_at || "").localeCompare(String(right?.kickoff_at || ""));
  });
}

export function orderH2HCandidatesByCompetition(candidates, attemptLedger = {}) {
  const ordered = orderH2HCandidatesByLastAttempt(candidates, attemptLedger);
  const queues = new Map();
  for (const candidate of ordered) {
    const league = String(candidate?.league || "unknown");
    if (!queues.has(league)) queues.set(league, []);
    queues.get(league).push(candidate);
  }
  const result = [];
  while ([...queues.values()].some((queue) => queue.length)) {
    for (const queue of queues.values()) {
      if (queue.length) result.push(queue.shift());
    }
  }
  return result;
}
