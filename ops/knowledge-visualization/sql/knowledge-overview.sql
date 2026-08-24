-- Knowledge Overview: totals split by provenance (§13 Dashboard 1).
-- Distinguishes TOTAL / BOOTSTRAP / INTERNAL / EXTERNAL / EXTERNAL APPROVED so
-- bootstrap volume can never masquerade as mature external knowledge.
SELECT
  s.source_category AS source_category,
  s.review_status  AS source_review_status,
  r.status         AS rule_status,
  r.claim_type     AS claim_type,
  count(*)         AS rule_count
FROM knowledge_rules r
JOIN knowledge_sources s ON s.id = r.source_id
GROUP BY 1, 2, 3, 4
ORDER BY rule_count DESC;
