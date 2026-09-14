import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mergeHistoricalContext } from './backfill-recent-match-context.js';

// Restore only dated context from the parent of an identified damaging commit.
// Scores, predictions, immutable snapshots and review records are never rewritten.
const commits = process.argv.slice(2);
if (!commits.length) throw new Error('Provide the audited post-match commit hashes');
const changes = [];
for (const commit of commits) {
  if (!/^[a-f0-9]{7,40}$/.test(commit)) throw new Error('Expected a commit hash');
  const files = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', commit], { encoding: 'utf8' }).trim().split('\n').filter(f => /^data\/days\/\d{4}-\d{2}-\d{2}\.json$/.test(f));
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const before = JSON.parse(execFileSync('git', ['show', `${commit}^:${file}`], { maxBuffer: 64 * 1024 * 1024 }));
    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    const old = new Map(before.matches.map(m => [m.id, m]));
    let changed = false;
    for (const match of current.matches) {
      const previous = old.get(match.id);
      if (!previous || previous.homeTeamName !== match.homeTeamName || previous.awayTeamName !== match.awayTeamName) continue;
      const candidate = { ...match,
        h2h: { played: 0, results: [...(previous.h2h?.results || []), ...(match.h2h?.results || [])] },
      };
      for (const side of ['home', 'away']) candidate[`${side}Recent`] = { gamesPlayed: 0, recentMatches: [...(previous[`${side}Recent`]?.recentMatches || []), ...(match[`${side}Recent`]?.recentMatches || [])] };
      const recovered = mergeHistoricalContext(candidate);
      for (const field of ['h2h', 'homeRecent', 'awayRecent']) {
        const count = v => Number(v?.played || v?.gamesPlayed || 0);
        if (count(recovered[field]) <= count(match[field])) continue;
        changes.push({ commit, file, matchId: match.id, field, before: count(match[field]), after: count(recovered[field]) });
        match[field] = recovered[field];
        if (field === 'h2h') match.h2hStatus = recovered.h2hStatus;
        else match[field === 'homeRecent' ? 'homeForm' : 'awayForm'] = recovered[field].form;
        changed = true;
      }
    }
    if (changed) fs.writeFileSync(file, JSON.stringify(current) + '\n');
  }
}
const report = { checkedAt: new Date().toISOString(), commits, restoredFields: changes.length, changes, note: 'Only prior dated context recovered; no prediction/snapshot/review or outcome changes.' };
fs.writeFileSync('monitor/post-match-context-recovery.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ restoredFields: changes.length, matches: new Set(changes.map(c => c.matchId)).size }));
