// Execution evidence is separate from data quality: a successful job may soft-skip.
export const WORKFLOW_POLICIES = [
  ['orchestrator.yml', 4], ['worker.yml', 12], ['live-score.yml', 6],
  ['neon-health.yml', 4], ['prediction-evaluation.yml', 36],
  ['daily-prediction-monitor.yml', 36], ['provider-quota-audit.yml', 36],
  ['post-match-enrichment.yml', 36], ['regression-assertions.yml', 36],
  ['biweekly-review-digest.yml', 192], ['storage-recovery.yml', 18],
];

export function assessWorkflowRuns(runs, { now = Date.now(), maxAgeHours = 24 } = {}) {
  const ordered = [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const completed = ordered.filter(r => r.status === 'completed');
  const latest = completed[0];
  const success = completed.find(r => r.conclusion === 'success');
  const lastSuccessAt = success?.updated_at || null;
  const ageHours = lastSuccessAt ? (now - Date.parse(lastSuccessAt)) / 3600000 : null;
  const reasons = [];
  if (!ordered.length) reasons.push('missing_runs');
  if (ageHours == null || !Number.isFinite(ageHours)) reasons.push('success_not_observed');
  else if (ageHours < -5 / 60) reasons.push('invalid_future');
  else if (ageHours > maxAgeHours) reasons.push('stale_success');
  if (latest && latest.conclusion !== 'success') reasons.push(`latest_${latest.conclusion}`);
  let consecutiveFailures = 0;
  for (const run of completed) {
    if (run.conclusion === 'success') break;
    if (['failure', 'timed_out', 'startup_failure', 'action_required'].includes(run.conclusion)) consecutiveFailures++;
  }
  if (consecutiveFailures >= 3) reasons.push('repeated_failure');
  const pending = ordered.filter(r => r.status !== 'completed');
  if (pending.some(r => now - Date.parse(r.created_at) > 2 * 3600000)) reasons.push('pending_over_two_hours');
  const durations = completed.map(r => (Date.parse(r.updated_at) - Date.parse(r.run_started_at)) / 60000).filter(v => Number.isFinite(v) && v >= 0).sort((a,b) => a-b);
  return {
    status: reasons.length ? 'degraded' : 'ok', reasons, maxAgeHours,
    latestConclusion: latest?.conclusion || null, latestRunUrl: latest?.html_url || null,
    lastSuccessAt, consecutiveFailures, observedRuns: ordered.length,
    failures: completed.filter(r => r.conclusion === 'failure' || r.conclusion === 'timed_out').length,
    cancelled: completed.filter(r => r.conclusion === 'cancelled').length,
    pending: pending.length,
    p95ElapsedMinutes: durations.length ? Math.round(durations[Math.ceil(durations.length * .95) - 1] * 10) / 10 : null,
    recovery: latest?.conclusion === 'success' && completed.slice(1).some(r => r.conclusion === 'failure') ? 'execution_recovered_data_unverified' : null,
  };
}

export function assessWorkflowReport(report, now = Date.now()) {
  const age = now - Date.parse(report?.generatedAt);
  if (!report || !Number.isFinite(age)) return { status: 'unknown', reasons: ['monitor_report_missing'], workflows: [] };
  if (age < -300000 || age > 8 * 3600000) return { ...report, status: 'unknown', reasons: ['monitor_report_stale_or_invalid'] };
  return report;
}
