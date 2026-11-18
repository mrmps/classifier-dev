#!/usr/bin/env bash
set -euo pipefail
: "${JEFF_API_KEY:?Set a secret JEFF_API_KEY of at least 24 characters}"
python /app/fetch.py --recipe /app/recipe --checkpoint "${JEFF_CHECKPOINT:-/opt/model}"
exec python /app/server.py --recipe /app/recipe --checkpoint "${JEFF_CHECKPOINT:-/opt/model}" \
  --host "${JEFF_HOST:-0.0.0.0}" --port 8080 \
  --max-batch "${JEFF_MAX_BATCH:-8}" \
  --max-batch-tokens "${JEFF_MAX_BATCH_TOKENS:-8192}" \
  --batch-wait-ms "${JEFF_BATCH_WAIT_MS:-2}" \
  --bulk-wait-ms "${JEFF_BULK_WAIT_MS:-10}" \
  --max-queue "${JEFF_MAX_QUEUE:-128}" \
  --graphs "${JEFF_GRAPHS:-off}"
