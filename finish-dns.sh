#!/usr/bin/env bash
# Finishes DNS for classifier.dev once the zone exists in Cloudflare.
#
# Why this is a separate step: neither Cloudflare token on this machine has
# "com.cloudflare.api.account.zone.create", so the zone must be added once by
# hand at https://dash.cloudflare.com  ->  Add a domain  ->  classifier.dev
# (choose the Free plan; do NOT change nameservers there, this script does it).
#
# Then run:  ./finish-dns.sh
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.secrets.env; set +a

DOMAIN=classifier.dev
WORKER=classifier-dev

echo "==> looking up zone"
ZONE=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=$DOMAIN" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
ZONE_ID=$(echo "$ZONE" | python3 -c "import json,sys; r=json.load(sys.stdin).get('result') or []; print(r[0]['id'] if r else '')")

if [ -z "$ZONE_ID" ]; then
  echo "   zone not found."
  echo "   Add $DOMAIN at https://dash.cloudflare.com (Free plan), then re-run."
  exit 1
fi
echo "   zone $ZONE_ID"

NS=$(echo "$ZONE" | python3 -c "import json,sys; print(' '.join(json.load(sys.stdin)['result'][0]['name_servers']))")
echo "==> cloudflare nameservers: $NS"

echo "==> pointing porkbun at cloudflare"
NS_JSON=$(NS="$NS" python3 -c "
import json, os
print(json.dumps({
    'apikey': os.environ['PORKBUN_API_KEY'],
    'secretapikey': os.environ['PORKBUN_SECRET_KEY'],
    'ns': os.environ['NS'].split(),
}))")
curl -s "https://api.porkbun.com/api/json/v3/domain/updateNs/$DOMAIN" \
  -H "Content-Type: application/json" -d "$NS_JSON" | head -c 200; echo

echo "==> attaching worker to $DOMAIN and www"
for host in "$DOMAIN" "www.$DOMAIN"; do
  curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
    -d "{\"environment\":\"production\",\"hostname\":\"$host\",\"service\":\"$WORKER\",\"zone_id\":\"$ZONE_ID\"}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('   $host ->', 'ok' if d.get('success') else [e.get('message') for e in d.get('errors',[])])"
done

echo
echo "Done. Nameserver propagation is usually minutes, up to 24h."
echo "Check:  curl https://$DOMAIN"
