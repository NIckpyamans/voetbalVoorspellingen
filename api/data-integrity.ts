import { getSql } from "../shared/database.js";
import { setCorsHeaders } from "../shared/cors.js";

export default async function handler(req: any, res: any) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const sql = getSql();
  if (!sql) return res.status(503).json({ ok: false, error: "database_not_configured" });
  try {
    const [summaryRows, quarantine, providers, conflicts, auditCoverage] = await Promise.all([
      sql.query(`
        select count(1)::int matches,
          count(1) filter(where identity_status='resolved')::int resolved_matches,
          count(1) filter(where identity_status='quarantined')::int quarantined_matches,
          (select count(1)::int from source_conflicts) conflicts,
          (select count(1)::int from source_audit) audit_rows,
          (select count(distinct prediction_id)::int from source_audit) audited_predictions,
          (select count(1)::int from prediction_snapshots) prediction_snapshots,
          (select count(1)::int from historical_odds_snapshots where available_before_kickoff=true) prematch_odds,
          (select count(1)::int from historical_odds_snapshots where closing_captured_at is not null) closing_pairs,
          (select count(1)::int from h2h_edges) h2h_edges
        from matches
      `),
      sql.query(`
        select m.match_id,m.date_key,m.league,m.home_team_name,m.away_team_name,m.identity_missing_fields,
          q.attempts,q.last_attempt_at,q.resolution_payload
        from matches m left join match_identity_quarantine q on q.match_id=m.match_id
        where m.identity_status='quarantined' order by m.date_key desc nulls last limit 24
      `),
      sql.query(`
        select provider,effective_trust_score,records_count,timestamp_coverage,conflict_rate,metrics,updated_at
        from provider_trust_profiles order by records_count desc,effective_trust_score desc limit 24
      `),
      sql.query(`
        select entity_key,field_name,candidate_values,selected_value,resolution_method,status,detected_at
        from source_conflicts order by detected_at desc limit 20
      `),
      sql.query(`
        select field_name,count(1)::int rows,count(1) filter(where available)::int available,
          round(count(1) filter(where available)::numeric/greatest(count(1),1),3) coverage
        from source_audit group by field_name order by field_name
      `),
    ]);
    return res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      summary: summaryRows[0] || {},
      quarantine,
      providers,
      conflicts,
      auditCoverage,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || "integrity_query_failed" });
  }
}
