-- Collection Runs (§17 Dashboard 5): per-run ingestion and review outcomes,
-- plus duplicate protection metrics (document_duplicates, candidate_duplicates).
SELECT
  id                          AS run_id,
  status                      AS status,
  started_at                  AS started_at,
  finished_at                 AS finished_at,
  extract(epoch FROM (COALESCE(finished_at, now()) - started_at)) AS duration_seconds,
  sources_crawled             AS sources_crawled,
  documents_added             AS documents_added,
  document_duplicates         AS document_duplicates,
  candidates_inserted         AS candidates_inserted,
  corroborated_candidates     AS corroborated_candidates,
  candidate_duplicates        AS candidate_duplicates,
  needs_review                AS needs_review,
  conflicts                   AS conflicts,
  jsonb_array_length(errors::jsonb) AS error_count
FROM knowledge_collection_runs
ORDER BY started_at DESC;
