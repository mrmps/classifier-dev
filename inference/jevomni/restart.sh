#!/bin/bash
# Start, or restart, the server. Separate from provision.sh so a restart does
# not re-download 23GB of weights.
#
#   ssh root@<pod> "JEVOMNI_TOKEN=... setsid /root/restart.sh &"
set -euo pipefail
: "${JEVOMNI_TOKEN:?set JEVOMNI_TOKEN in the environment}"

cd /root
./stop.sh

# Drop any cached bytecode, so a patched jev_omni.py is actually the thing that
# loads rather than a stale .pyc.
rm -rf /root/__pycache__

# --no-access-log is required, not a preference. Uvicorn's access log records
# the client address of every request, which src/privacy.ts exists to keep out
# of anything we hold. Through RunPod's proxy those are its own 100.64.x hops,
# but the pod has a public IP and they are real caller addresses the moment it
# is reached directly.
#
# Tracing stays off around this line: `set -x` here would echo the bearer into
# the log file, which is how it leaked on the first pod.
exec setsid env HF_HOME=/root/hf JEVOMNI_TOKEN="$JEVOMNI_TOKEN" nohup \
  uvicorn server:app --host 0.0.0.0 --port 8000 --workers 1 --no-access-log \
  > /root/serve.log 2>&1 < /dev/null
