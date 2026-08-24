-- Crystal Atlas coverage (§24): per-crystal gemology / visual / cultural
-- completeness signals derived from live rules only.
SELECT
  r.subject                     AS subject,
  r.knowledge_domain            AS knowledge_domain,
  s.source_category             AS source_category,
  r.status                      AS rule_status,
  count(*)                      AS rule_count,
  count(*) FILTER (WHERE r.claim_type = 'GEMOLOGICAL_FACT') AS gemological_fact_count,
  count(*) FILTER (WHERE r.claim_type = 'CULTURAL_ASSOCIATION') AS cultural_count
FROM knowledge_rules r
JOIN knowledge_sources s ON s.id = r.source_id
WHERE r.subject LIKE 'material:%'
GROUP BY 1, 2, 3, 4
ORDER BY subject, knowledge_domain;
