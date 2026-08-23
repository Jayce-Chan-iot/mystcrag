#!/usr/bin/env bash
# Verifies the mystcrag_reader role can read but never write the Mystcrag DB.
# Exit 0 only when READ PASS and every WRITE path is DENIED.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ENV FILE MISSING: $ENV_FILE (create it from ../.env.example)"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${MYSTCRAG_READER_HOST:?}" "${MYSTCRAG_READER_PORT:?}" "${MYSTCRAG_READER_DB:?}" "${MYSTCRAG_READER_USER:?}" "${MYSTCRAG_READER_PASSWORD:?}"

export PGPASSWORD="$MYSTCRAG_READER_PASSWORD"
READER_URI="postgresql://${MYSTCRAG_READER_USER}@${MYSTCRAG_READER_HOST}:${MYSTCRAG_READER_PORT}/${MYSTCRAG_READER_DB}"

read_test() {
  psql "$READER_URI" -tAc "SELECT count(*) FROM knowledge_rules" >/dev/null 2>&1
}

write_test() {
  local sql="$1"
  psql "$READER_URI" -v ON_ERROR_STOP=1 -c "$sql" >/dev/null 2>&1
}

FAILURES=0

if read_test; then
  echo "READ TEST: PASS (SELECT knowledge_rules)"
else
  echo "READ TEST: FAIL (SELECT knowledge_rules)"
  FAILURES=$((FAILURES + 1))
fi

check_denied() {
  local label="$1" sql="$2"
  if write_test "$sql"; then
    echo "WRITE BLOCK TEST: FAIL ($label was ALLOWED)"
    FAILURES=$((FAILURES + 1))
  else
    echo "WRITE BLOCK TEST: PASS ($label DENIED)"
  fi
}

check_denied "INSERT"   "INSERT INTO knowledge_usage_events (id) VALUES ('probe-readonly')"
check_denied "UPDATE"   "UPDATE knowledge_sources SET name = name"
check_denied "DELETE"   "DELETE FROM knowledge_usage_events WHERE id = 'probe-readonly'"
check_denied "CREATE TABLE" "CREATE TABLE readonly_probe (id text)"
check_denied "DROP TABLE"  "DROP TABLE knowledge_rules"
check_denied "TRUNCATE"    "TRUNCATE knowledge_usage_events"

if [[ "$FAILURES" -eq 0 ]]; then
  echo "READONLY VERIFICATION: ALL PASS"
  exit 0
fi
echo "READONLY VERIFICATION: ${FAILURES} FAILURE(S)"
exit 1
