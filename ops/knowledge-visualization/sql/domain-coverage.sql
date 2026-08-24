-- Domain Coverage (§14 Dashboard 2): live counts per knowledge domain and
-- provenance. Targets come from config (docs/KNOWLEDGE_SYSTEM_SPEC.md), never
-- from stale audit JSON snapshots.
SELECT
  r.knowledge_domain                  AS knowledge_domain,
  r.knowledge_type                    AS knowledge_type,
  s.source_category                   AS source_category,
  r.status                            AS rule_status,
  count(*)                            AS rule_count
FROM knowledge_rules r
JOIN knowledge_sources s ON s.id = r.source_id
GROUP BY 1, 2, 3, 4
ORDER BY knowledge_domain, rule_count DESC;
