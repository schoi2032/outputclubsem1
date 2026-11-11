#!/usr/bin/env bash
# Deploys a LiveKit media server for Quid Voice on a small GCE VM.
#
#   PROJECT_ID=my-project ./infra/livekit/deploy.sh
#   DRY_RUN=1 PROJECT_ID=my-project ./infra/livekit/deploy.sh
#
# No domain needed: Caddy gets a Let's Encrypt certificate for
# livekit.<ip-with-dashes>.sslip.io, which resolves to the VM's static IP.
# Afterwards, re-run infra/gcp/deploy.sh so the API picks up the LiveKit settings.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-northeast3}"
ZONE="${ZONE:-${REGION}-a}"
PREFIX="${PREFIX:-quid}"
MACHINE="${LIVEKIT_MACHINE:-e2-small}"   # audio for a small team; use e2-standard-2 for video (Meet)
VM="${PREFIX}-livekit"
SA="${PREFIX}-livekit@${PROJECT_ID}.iam.gserviceaccount.com"
DRY_RUN="${DRY_RUN:-0}"

run() {
  echo "+ $*"
  if [[ "$DRY_RUN" != "1" ]]; then "$@"; fi
}
exists() { [[ "$DRY_RUN" == "1" ]] && return 1; "$@" >/dev/null 2>&1; }
secret() {
  local name="$1" value="$2"
  if exists gcloud secrets describe "$name"; then
    [[ "${3:-}" == "update" ]] || return 0
    echo "+ gcloud secrets versions add $name (value hidden)"
    [[ "$DRY_RUN" == "1" ]] || printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=-
    return 0
  fi
  echo "+ gcloud secrets create $name (value hidden)"
  [[ "$DRY_RUN" == "1" ]] || printf '%s' "$value" | gcloud secrets create "$name" --replication-policy=automatic --data-file=-
}

[[ "$DRY_RUN" == "1" ]] || command -v gcloud >/dev/null || { echo "gcloud CLI not found"; exit 1; }
run gcloud config set project "$PROJECT_ID"
run gcloud services enable compute.googleapis.com secretmanager.googleapis.com

echo "== Static IP and firewall"
exists gcloud compute addresses describe "${VM}-ip" --region "$REGION" ||
  run gcloud compute addresses create "${VM}-ip" --region "$REGION"
IP="$( [[ "$DRY_RUN" == "1" ]] && echo 203.0.113.10 || gcloud compute addresses describe "${VM}-ip" --region "$REGION" --format='value(address)')"
HOST="livekit.${IP//./-}.sslip.io"
exists gcloud compute firewall-rules describe "${VM}-media" ||
  run gcloud compute firewall-rules create "${VM}-media" --network default --direction INGRESS --target-tags "$VM" \
    --allow tcp:80,tcp:443,tcp:7881,udp:50000-60000 --description "LiveKit signalling (TLS), ACME and WebRTC media"

echo "== Credentials"
secret "${PREFIX}-livekit-key" "API$(openssl rand -hex 6)"
secret "${PREFIX}-livekit-secret" "$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-40)"
secret "${PREFIX}-livekit-url" "wss://${HOST}" update

echo "== Service account"
exists gcloud iam service-accounts describe "$SA" || run gcloud iam service-accounts create "${PREFIX}-livekit" --display-name "Quid LiveKit VM"
for s in "${PREFIX}-livekit-key" "${PREFIX}-livekit-secret"; do
  run gcloud secrets add-iam-policy-binding "$s" --member "serviceAccount:${SA}" --role roles/secretmanager.secretAccessor --quiet >/dev/null
done

# The VM reads its keys from Secret Manager at boot; they never appear in instance metadata.
STARTUP="$(mktemp)"
trap 'rm -f "$STARTUP"' EXIT
cat > "$STARTUP" <<EOF
#!/bin/bash
set -euo pipefail
MD=http://metadata.google.internal/computeMetadata/v1
secret() {
  local token
  token=\$(curl -sf -H 'Metadata-Flavor: Google' \$MD/instance/service-accounts/default/token | sed -E 's/.*"access_token":"([^"]+)".*/\1/') || return 1
  curl -sf -H "Authorization: Bearer \$token" "https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets/\$1/versions/latest:access" | tr -d ' \\n' | sed -E 's/.*"data":"([^"]+)".*/\1/' | base64 -d
}
# Access granted moments before the VM was created can take a few minutes to apply: keep trying.
KEY=""; SECRET=""
for attempt in \$(seq 1 60); do
  KEY=\$(secret ${PREFIX}-livekit-key 2>/dev/null || true)
  SECRET=\$(secret ${PREFIX}-livekit-secret 2>/dev/null || true)
  [ -n "\$KEY" ] && [ -n "\$SECRET" ] && break
  echo "quid: waiting for access to LiveKit secrets (attempt \$attempt)"
  sleep 10
done
[ -n "\$KEY" ] && [ -n "\$SECRET" ] || { echo "quid: could not read LiveKit secrets"; exit 1; }
# Container-Optimized OS's host firewall only lets SSH in: open HTTPS, ACME and WebRTC media.
iptables -w -C INPUT -p tcp -m multiport --dports 80,443,7881 -j ACCEPT 2>/dev/null || iptables -w -A INPUT -p tcp -m multiport --dports 80,443,7881 -j ACCEPT
iptables -w -C INPUT -p udp --dport 50000:60000 -j ACCEPT 2>/dev/null || iptables -w -A INPUT -p udp --dport 50000:60000 -j ACCEPT
mkdir -p /var/lib/quid/caddy
cat > /var/lib/quid/livekit.yaml <<YAML
port: 7880
bind_addresses: ["127.0.0.1"]
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  \$KEY: \$SECRET
logging:
  level: info
YAML
cat > /var/lib/quid/Caddyfile <<CADDY
${HOST} {
  reverse_proxy 127.0.0.1:7880
}
CADDY
docker rm -f livekit caddy 2>/dev/null || true
docker run -d --name livekit --restart unless-stopped --network host -v /var/lib/quid/livekit.yaml:/livekit.yaml:ro livekit/livekit-server:latest --config /livekit.yaml
docker run -d --name caddy --restart unless-stopped --network host -v /var/lib/quid/Caddyfile:/etc/caddy/Caddyfile:ro -v /var/lib/quid/caddy:/data caddy:2
EOF

echo "== VM (${MACHINE}, ${ZONE})"
if exists gcloud compute instances describe "$VM" --zone "$ZONE"; then
  run gcloud compute instances add-metadata "$VM" --zone "$ZONE" --metadata-from-file startup-script="$STARTUP"
  run gcloud compute instances reset "$VM" --zone "$ZONE"
else
  run gcloud compute instances create "$VM" --zone "$ZONE" --machine-type "$MACHINE" \
    --image-family cos-stable --image-project cos-cloud --boot-disk-size 10GB \
    --address "$IP" --tags "$VM" --service-account "$SA" --scopes cloud-platform \
    --metadata-from-file startup-script="$STARTUP"
fi

echo
echo "LiveKit will be reachable at wss://${HOST} once the certificate is issued (about a minute)."
echo "Check: curl https://${HOST}  (should print OK)"
echo "Now re-run infra/gcp/deploy.sh so the API uses it."
