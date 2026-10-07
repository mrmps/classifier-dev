#!/usr/bin/env bash
set -euo pipefail
# Run after setup.sh with both private token files provisioned out of band.
# A failed process must restart; readiness must wait for model warmup.
test -s /opt/classifier-imajev-token
test -s /opt/classifier-tunnel-token
if [ -e /pre_start.sh ] && ! grep -q '/opt/classifier-imajev/supervisord.conf' /pre_start.sh; then
  echo 'Existing /pre_start.sh must be integrated before installing this service.' >&2
  exit 1
fi
chmod 600 /opt/classifier-imajev-token /opt/classifier-tunnel-token
/opt/imajev-venv/bin/python -m pip install supervisor==4.2.5
curl --fail --location --retry 2 https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod 755 /usr/local/bin/cloudflared
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
mkdir -p /opt/classifier-imajev
for file in server.py run.sh boot.sh supervisord.conf; do
  if ! [ "$source_dir" -ef /opt/classifier-imajev ]; then
    install -m 600 "$source_dir/$file" "/opt/classifier-imajev/$file"
  fi
done
install -m 755 /usr/local/bin/cloudflared /opt/classifier-imajev/cloudflared
chmod 700 /opt/classifier-imajev/run.sh /opt/classifier-imajev/boot.sh
cat > /pre_start.sh <<'START'
#!/usr/bin/env bash
set -euo pipefail
exec /opt/imajev-venv/bin/supervisord -c /opt/classifier-imajev/supervisord.conf
START
chmod 700 /pre_start.sh
/pre_start.sh
