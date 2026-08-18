export function orderH2HCandidatesByLastAttempt(candidates, attemptLedger = {}) {
  return [...(candidates || [])].sort((left, right) => {
    const leftCheckedAt = Date.parse(attemptLedger[left?.match_id]?.checkedAt || "") || 0;
    const rightCheckedAt = Date.parse(attemptLedger[right?.match_id]?.checkedAt || "") || 0;
    return leftCheckedAt - rightCheckedAt || String(left?.kickoff_at || "").localeCompare(String(right?.kickoff_at || ""));
  });
}
