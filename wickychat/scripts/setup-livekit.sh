#!/usr/bin/env bash
# WickyChat: turn on voice rooms, calls and Meet in production with LiveKit Cloud.
#
# 1. Make a free project at https://cloud.livekit.io (pick a region near Korea, e.g. Tokyo).
# 2. In the project: Settings → Keys → create a key. Keep that page open.
# 3. Run this script in your own terminal (it asks for each value; the secret isn't shown):
#      ./scripts/setup-livekit.sh
# It saves the three values to Vercel (production) and redeploys.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v vercel >/dev/null || { echo "Install the Vercel CLI first: npm i -g vercel"; exit 1; }

echo "LiveKit URL (looks like wss://your-project.livekit.cloud):"
read -r url
case "$url" in
  wss://*) ;;
  *) echo "That should start with wss://"; exit 1 ;;
esac
echo "API key (starts with API…):"
read -r key
echo "API secret (hidden as you type):"
read -rs secret
echo

for name in LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
  vercel env rm "$name" production --yes >/dev/null 2>&1 || true
done
printf '%s' "$url" | vercel env add LIVEKIT_URL production >/dev/null
printf '%s' "$key" | vercel env add LIVEKIT_API_KEY production >/dev/null
printf '%s' "$secret" | vercel env add LIVEKIT_API_SECRET production --sensitive >/dev/null
unset secret
echo "Saved to Vercel. Redeploying so the API picks them up…"
vercel deploy --prod --yes >/dev/null
echo "Done. Voice rooms, calls and Meet should work now."
