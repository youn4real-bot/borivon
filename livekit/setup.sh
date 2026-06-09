#!/usr/bin/env bash
# One-shot LiveKit setup for a fresh VPS. Idempotent: re-running keeps your keys.
set -euo pipefail
cd "$(dirname "$0")"

# 1) Docker (installs the official engine + compose plugin if missing)
if ! command -v docker >/dev/null 2>&1; then
  echo "→ Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi

# 2) Generate API key + secret ONCE → .env (gitignored, never leaves the VPS)
if [ ! -f .env ]; then
  KEY="API$(openssl rand -hex 6)"
  SECRET="$(openssl rand -hex 32)"
  printf 'LIVEKIT_KEYS=%s: %s\n' "$KEY" "$SECRET" > .env
  echo
  echo "============================================================"
  echo "  LiveKit credentials generated — paste into Vercel:"
  echo "    LIVEKIT_API_KEY=$KEY"
  echo "    LIVEKIT_API_SECRET=$SECRET"
  echo "  (also stored in livekit/.env — keep it safe, don't commit)"
  echo "============================================================"
  echo
fi

# 3) Bring it up
docker compose up -d
echo
echo "→ LiveKit + Caddy are starting."
echo "  Watch logs:   docker compose logs -f"
echo "  Your keys:    cat .env"
echo "  Health check: curl -s http://localhost:7880  (should say 'OK')"
