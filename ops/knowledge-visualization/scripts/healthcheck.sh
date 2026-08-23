#!/usr/bin/env bash
# Health check for the local visualization stack.
set -u
FAILED=0

if curl -s --noproxy '*' --max-time 5 -o /dev/null http://127.0.0.1:8100/; then
  echo "DataEase (127.0.0.1:8100): UP"
else
  echo "DataEase (127.0.0.1:8100): DOWN (launch /Applications/DataEase.app)"
  FAILED=1
fi

if pgrep -q -f "DMS.app/Contents/MacOS/DMS"; then
  echo "DMS desktop client: UP"
else
  echo "DMS desktop client: DOWN (launch /Applications/DMS.app)"
  FAILED=1
fi

if pg_isready -q; then
  echo "PostgreSQL: UP"
else
  echo "PostgreSQL: DOWN"
  FAILED=1
fi

exit "$FAILED"
