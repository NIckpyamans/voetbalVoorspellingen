#!/usr/bin/env node
import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { getSql, loadLocalEnv } from '../shared/database.js';
import { getR2Config, buildR2ObjectKey, putR2Object, getR2Object } from '../shared/cloudflare-r2.js';
loadLocalEnv(process.cwd());
const sql = getSql();
const config = getR2Config();
if (!sql || !config.configured) throw new Error('Database and R2 must both be configured; no cache changed');
let archived = 0;
// Only derived cache, never canonical matches, source records or prediction snapshots.
for (let batch = 0; batch < 1000; batch++) {
  const [row] = await sql.query(`select *, updated_at::text as exact_updated_at, md5(payload::text) as payload_hash
    from app_state_segments
    where segment_group in ('root','matches','predictions','predictionSnapshots')
      and updated_at < now() - interval '2 days'
    order by updated_at, segment_group, segment_key limit 1`);
  if (!row) break;
  const raw = Buffer.from(JSON.stringify(row));
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const key = buildR2ObjectKey(config, `recovery/app-state/${hash}.json.gz`);
  const upload = await putR2Object({ config, key, body: gzipSync(raw), contentType: 'application/gzip' });
  if (!upload.ok) throw new Error('Archive upload unconfirmed; cache retained');
  const copy = await getR2Object({ config, key });
  if (!copy.ok || !gunzipSync(copy.body).equals(raw)) throw new Error('Archive verification failed; cache retained');
  // An intervening refresh must never be removed by this maintenance run.
  const deleted = await sql.query(`delete from app_state_segments
    where segment_group=$1 and segment_key=$2 and updated_at=$3::timestamptz
      and md5(payload::text)=$4 returning segment_key`,
    [row.segment_group, row.segment_key, row.exact_updated_at, row.payload_hash]);
  if (!deleted.length) throw new Error("Cache changed during archival; verified copy retained, rerun with fresh input");
  archived += deleted.length;
  console.log(JSON.stringify({ archivedKey: key, bytes: raw.length, removedCacheRows: deleted.length }));
}
if (archived) await sql.query('vacuum (full, analyze) app_state_segments');
console.log(JSON.stringify({ archived, canonicalDataChanged: false }));
