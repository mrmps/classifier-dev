#!/usr/bin/env bash
set -euo pipefail
case "${1:-model}" in
  model)
    export IMAJEV_TOKEN="$(cat /opt/classifier-imajev-token)"
    exec /opt/imajev-venv/bin/python /opt/classifier-imajev/server.py
    ;;
  tunnel)
    exec /usr/local/bin/cloudflared tunnel --no-autoupdate run --token-file /opt/classifier-tunnel-token
    ;;
  *) exit 2 ;;
esac
