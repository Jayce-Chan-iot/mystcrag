-- Source Quality / Yield (§16 Dashboard 4): per-source document and rule yield.
-- candidate yield = candidate rules / documents; approval yield = approved / documents.
-- Document and rule counts are pre-aggregated to avoid a cross-product scan.
WITH doc_stats AS (
  SELECT source_id, count(*) AS document_count
  FROM knowledge_documents
  GROUP BY source_id
),
rule_stats AS (
  SELECT
    source_id,
    count(*) AS rule_count,
    count(*) FILTER (WHERE status = 'APPROVED')     AS approved_count,
    count(*) FILTER (WHERE status = 'NEEDS_REVIEW') AS needs_review_count,
    count(*) FILTER (WHERE status = 'CONFLICTED')   AS conflicted_count
  FROM knowledge_rules
  GROUP BY source_id
)
SELECT
  s.id                    AS source_id,
  s.name                  AS source_name,
  s.source_category       AS source_category,
  s.review_status         AS review_status,
  s.enabled               AS enabled,
  s.authority_score       AS authority_score,
  s.reliability_level     AS reliability_level,
  s.last_successful_fetch AS last_successful_fetch,
  s.consecutive_failures  AS consecutive_failures,
  COALESCE(d.document_count, 0)   AS document_count,
  COALESCE(r.rule_count, 0)       AS rule_count,
  COALESCE(r.approved_count, 0)   AS approved_count,
  COALESCE(r.needs_review_count, 0) AS needs_review_count,
  COALESCE(r.conflicted_count, 0) AS conflicted_count
FROM knowledge_sources s
LEFT JOIN doc_stats d ON d.source_id = s.id
LEFT JOIN rule_stats r ON r.source_id = s.id
ORDER BY document_count DESC, rule_count DESC;
