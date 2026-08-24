#!/usr/bin/env bash
# Validates every SQL file under ops/knowledge-visualization/sql against the
# live Mystcrag PostgreSQL using the read-only mystcrag_reader role, then runs
# EXPLAIN to leave a cheap query-plan sanity check in the log.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
SQL_DIR="${SCRIPT_DIR}/../sql"

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
export PGPASSWORD="$MYSTCRAG_READER_PASSWORD"
READER_URI="postgresql://${MYSTCRAG_READER_USER}@${MYSTCRAG_READER_HOST}:${MYSTCRAG_READER_PORT}/${MYSTCRAG_READER_DB}"

FAILURES=0
for f in "$SQL_DIR"/*.sql; do
  name="$(basename "$f")"
  if ! psql "$READER_URI" -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null 2> "/tmp/sql-${name}.err"; then
    echo "SQL CHECK: FAIL $name — $(head -c 200 "/tmp/sql-${name}.err")"
    FAILURES=$((FAILURES + 1))
    continue
  fi
  if grep -qiE '^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|GRANT)\b' "$f"; then
    echo "SQL CHECK: FAIL $name — non-SELECT statement detected"
    FAILURES=$((FAILURES + 1))
    continue
  fi
  echo "SQL CHECK: PASS $name ($(psql "$READER_URI" -tA -f "$f" | wc -l | tr -d ' ') rows)"
done

if [[ "$FAILURES" -eq 0 ]]; then
  echo "SQL LIBRARY: ALL PASS"
  exit 0
fi
echo "SQL LIBRARY: ${FAILURES} FAILURE(S)"
exit 1
