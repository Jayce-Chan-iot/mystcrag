# Knowledge Visualization Stack (DMS + DataEase)

Read-only inspection layer over the Mystcrag PostgreSQL knowledge base. No
visualization tool may write knowledge data — formal writes go through the
Knowledge Console → Admin API → Review Service path only.

```
PostgreSQL (mystcrag)
   ├── 阿里 DMS 桌面客户端   (DB inspection, ER, manual queries)
   ├── DataEase 桌面版       (BI dashboards, port 8100)
   └── Knowledge Console     (/admin/knowledge, the only write path)
```

## Read-only role

`mystcrag_reader` connects with CONNECT/USAGE/SELECT only; INSERT, UPDATE,
DELETE, CREATE, DROP and TRUNCATE are all denied (G03–G05).

```bash
# create/rotate (run once, as the DB owner):
scripts/verify-readonly-db-access.sh          # proves SELECT PASS / writes DENIED
scripts/verify-sql-library.sh                 # validates sql/*.sql as reader
```

Credentials live in `.env` (gitignored, chmod 600); template in `.env.example`.
Never commit the real password.

## 阿里 DMS 桌面客户端 (macOS)

- Official download: https://dms.aliyun.com/desktop/download (free, no Aliyun
  account login required). The dmg is x86_64 — Rosetta 2 is required on Apple
  Silicon (`softwareupdate --install-rosetta --agree-to-license`).
- Installed at `/Applications/DMS.app`.
- Connection (the only manual step — type the password once in the GUI):

  | Field    | Value |
  |----------|-------|
  | Name     | Mystcrag Read Only |
  | Host     | localhost |
  | Port     | 5432 |
  | Database | mystcrag |
  | Username | mystcrag_reader |
  | Password | (in `.env`, `MYSTCRAG_READER_PASSWORD`) |

- Expected tables: `knowledge_sources`, `knowledge_documents`,
  `knowledge_rules`, `knowledge_versions`, `knowledge_usage_events`,
  `knowledge_collection_runs`.
- Write protection: verified by `scripts/verify-readonly-db-access.sh`.

## DataEase 桌面版 (BI)

- v2.10.x desktop edition — the official macOS install (arm64). Docker is NOT
  used: the server edition's quick-start script targets Linux only
  (https://dataease.cn/docs/v2/installation/online_installation/).
- Installed at `/Applications/DataEase.app`. Launching it starts a local
  backend on `127.0.0.1:8100` (config under `~/opt/dataease2.0/`). Closing all
  app windows stops the backend.
- Datasource `Mystcrag Read Only` is created programmatically:

```bash
node scripts/dataease-configure.mjs
# DATASEASE LOGIN: PASS / DATASOURCE VALIDATE: PASS / DATASOURCE SAVE: PASS
```

The script logs in as the desktop admin (password auto-generated in
`~/opt/dataease2.0/substitule.json`), validates the connection with the
reader credentials from `.env`, and saves the datasource. It never prints
either password.

### Dashboards

| # | Dashboard | Dataset | Backing SQL |
|---|-----------|---------|-------------|
| 1 | Knowledge Overview | overview (rules × sources) + sources + documents + runs | `sql/knowledge-overview.sql`, `sql/knowledge-growth.sql` |
| 2 | Domain Coverage | coverage by domain × provenance | `sql/domain-coverage.sql` |
| 3 | Review Backlog | rules by status/domain/claimType/source | `sql/review-backlog.sql` |
| 4 | Source Quality | per-source yield | `sql/source-yield.sql` |
| 5 | Collection Runs | per-run ingestion metrics | `sql/collection-runs.sql` |

All SQL in `sql/` is SELECT-only and re-verified against the live database by
`scripts/verify-sql-library.sh`. Dashboard numbers always come from the live
DB (§38 truth policy) — never from `outputs/*.json` snapshots.

## Health check

```bash
curl -s http://127.0.0.1:8100/ > /dev/null && echo "DataEase: UP" || echo "DataEase: DOWN"
scripts/verify-readonly-db-access.sh
```
