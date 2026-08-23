-- Review Backlog (§15 Dashboard 3): review-state distribution with domain and
-- claim-type filters. Feeds backlog trend / conflict ratio / approval rate.
SELECT
  r.status          AS rule_status,
  r.knowledge_domain AS knowledge_domain,
  r.claim_type      AS claim_type,
  s.name            AS source_name,
  r.confidence      AS confidence,
  r.subject         AS subject,
  r.relation        AS relation,
  r.created_at      AS created_at,
  r.updated_at      AS updated_at
FROM knowledge_rules r
JOIN knowledge_sources s ON s.id = r.source_id
ORDER BY r.updated_at DESC;
