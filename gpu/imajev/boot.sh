#!/usr/bin/env bash
set -euo pipefail
# RunPod start command: bash /workspace/classifier-imajev/boot.sh
# The container disk is disposable; code, dependencies, weights and tokens live on the volume.
for pair in imajev:imajev imajev-venv:venv classifier-imajev:classifier-imajev classifier-imajev-token:classifier-imajev-token classifier-tunnel-token:classifier-tunnel-token; do
  target="/workspace/${pair#*:}"
  test -e "$target"
  ln -sfn "$target" "/opt/${pair%%:*}"
done
install -m 755 /workspace/classifier-imajev/cloudflared /usr/local/bin/cloudflared
cat > /pre_start.sh <<'START'
#!/usr/bin/env bash
set -euo pipefail
exec /opt/imajev-venv/bin/supervisord -c /opt/classifier-imajev/supervisord.conf
START
chmod 700 /pre_start.sh
exec /start.sh
