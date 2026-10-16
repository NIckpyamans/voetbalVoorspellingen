import { describe, it, expect } from 'vitest';
import { assessWorkflowRuns, assessWorkflowReport } from '../../shared/workflowHealth.js';
import { assessAuditFreshness } from '../../scripts/worker/audit-freshness.js';
import { buildRows, rate } from '../../scripts/daily-prediction-monitor.js';
const now = Date.parse('2026-10-16T12:00:00Z');
const run = (conclusion, hours = 1) => ({ status: 'completed', conclusion, created_at: new Date(now - hours * 3600000).toISOString(), updated_at: new Date(now - hours * 3600000 + 60000).toISOString() });
describe('monitoring failure simulations', () => {
  it('never makes missing evidence green', () => {
    expect(assessWorkflowRuns([], { now }).status).toBe('degraded');
    expect(assessWorkflowReport(null, now).status).toBe('unknown');
  });
  it('detects repeated failure even with earlier success', () => {
    expect(assessWorkflowRuns([run('success', 4), run('failure', 1), run('failure', 2), run('failure', 3)], { now }).reasons).toContain('repeated_failure');
  });
  it('rejects a stale last success and blocked queue', () => {
    const result = assessWorkflowRuns([run('success', 30), { ...run(null, 3), status: 'queued' }], { now });
    expect(result.reasons).toContain('stale_success');
    expect(result.reasons).toContain('pending_over_two_hours');
  });
  it('requires a new successful execution to report recovery, not data recovery', () => {
    expect(assessWorkflowRuns([run('success'), run('failure', 2)], { now })).toMatchObject({ status: 'ok', recovery: 'execution_recovered_data_unverified' });
    expect(assessWorkflowRuns([run('cancelled'), run('failure', 2)], { now }).status).toBe('degraded');
  });
  it('expires watchdog evidence even if its saved status is green', () => {
    expect(assessWorkflowReport({ status: 'ok', generatedAt: run('success', 9).created_at }, now).status).toBe('unknown');
    expect(assessWorkflowReport({ status: 'degraded', generatedAt: run('success').created_at }, now).status).toBe('degraded');
  });
  it('rejects future report timestamps', () => {
    expect(assessAuditFreshness({ generatedAt: now + 3600000 }, { now })).toMatchObject({ fresh: false, status: 'invalid_future' });
    expect(assessWorkflowReport({ generatedAt: new Date(now + 3600000).toISOString() }, now).status).toBe('unknown');
  });
  it('excludes missing metrics instead of counting them as zero or incorrect', () => {
    const [row] = buildRows({ postMatchReviews: { a: { predictionId: 'p', brierScore: null, actualTotalGoals: null } }, predictionSnapshots: { p: { prediction: { homeXG: null, homeRestDays: null } } } });
    expect(Number.isNaN(row.brierScore)).toBe(true);
    expect(Number.isNaN(row.totalXG)).toBe(true);
    expect(row.totalGoalBias).toBeNull();
    expect(rate([row], r => r.outcomeHit)).toBeNull();
    expect(rate([{ hit: true }, { hit: false }, { hit: null }], r => r.hit)).toBe(.5);
  });
});
