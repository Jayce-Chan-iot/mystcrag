-- Knowledge Growth (§13 Dashboard 1 supplement): rules and documents per day,
-- split by provenance so external growth is visible separately from bootstrap.
WITH rule_growth AS (
  SELECT
    date_trunc('day', r.created_at)                        AS day,
    s.source_category                                      AS source_category,
    count(*)                                               AS rules_added
  FROM knowledge_rules r
  JOIN knowledge_sources s ON s.id = r.source_id
  GROUP BY 1, 2
),
doc_growth AS (
  SELECT
    date_trunc('day', d.created_at)                        AS day,
    s.source_category                                      AS source_category,
    count(*)                                               AS documents_added
  FROM knowledge_documents d
  JOIN knowledge_sources s ON s.id = d.source_id
  GROUP BY 1, 2
)
SELECT
  COALESCE(g.day, dg.day)          AS day,
  COALESCE(g.source_category, dg.source_category) AS source_category,
  COALESCE(g.rules_added, 0)       AS rules_added,
  COALESCE(dg.documents_added, 0)  AS documents_added
FROM rule_growth g
FULL OUTER JOIN doc_growth dg
  ON g.day = dg.day AND g.source_category = dg.source_category
ORDER BY day DESC;
