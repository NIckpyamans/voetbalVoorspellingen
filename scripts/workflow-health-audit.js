import fs from 'node:fs';
import { WORKFLOW_POLICIES, assessWorkflowRuns } from '../shared/workflowHealth.js';

const repo = process.env.GITHUB_REPOSITORY || 'NIckpyamans/voetbalVoorspellingen';
const branch = process.env.DATA_BRANCH || 'codex/step3b-layout';
const now = Date.now();
const since = new Date(now - 7 * 86400000).toISOString();
const headers = { Accept: 'application/vnd.github+json' };
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
const workflows = [];
for (const [workflow, maxAgeHours] of WORKFLOW_POLICIES) {
  try {
    const runs = [];
    let truncated = false;
    // At most 300 executions per workflow; explicitly disclose partial history.
    for (let page = 1; page <= 3; page++) {
      const query = new URLSearchParams({ branch, created: `>=${since}`, per_page: '100', page: String(page) });
      const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?${query}`, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`github_http_${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body.workflow_runs)) throw new Error('invalid_workflow_schema');
      runs.push(...body.workflow_runs);
      truncated = body.total_count > runs.length;
      if (!truncated || body.workflow_runs.length === 0) break;
    }
    workflows.push({ workflow, ...assessWorkflowRuns(runs, { now, maxAgeHours }), truncated });
  } catch (error) {
    workflows.push({ workflow, status: 'unknown', reasons: [String(error.message)], maxAgeHours });
  }
}
const report = { generatedAt: new Date(now).toISOString(), from: since, to: new Date(now).toISOString(),
  status: workflows.every(w => w.status === 'ok') ? 'ok' : 'degraded',
  scope: 'GitHub execution evidence; successful execution does not prove data publication', workflows,
  delivery: { channel: 'GitHub job summary, artifact and dashboard', externalNotification: 'not_configured_or_verified' } };
fs.mkdirSync('monitor', { recursive: true });
const file = 'monitor/workflow-health.json';
let previous;
try { previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
const signature = r => JSON.stringify((r?.workflows || []).map(w => [w.workflow, w.status, w.reasons]));
const publish = signature(previous) !== signature(report) || !(Date.parse(previous?.generatedAt) > now - 6 * 3600000);
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
const summary = ['## Workflow monitoring (last seven days)', '', '| Workflow | Status | Findings |', '|---|---|---|', ...workflows.map(w => `| ${w.workflow} | ${w.status} | ${w.reasons.join(', ') || 'None'} |`), '', report.scope].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\nstatus=${report.status}\n`);
console.log(summary);
// Report degradation explicitly; collection still succeeds so evidence can be published.
if (process.argv.includes('--check') && report.status !== 'ok') process.exitCode = 1;
