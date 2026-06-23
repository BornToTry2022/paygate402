#!/usr/bin/env bash
#
# One-shot Vercel deploy for PayGate402.
#
# Reads all secrets from .env.local (nothing sensitive is hardcoded here), pushes
# them to the Vercel project's Production env, and deploys. Re-runnable: it
# removes+re-adds each env var so you can run it again after rotating a key.
#
# Usage (from the project root, in YOUR interactive terminal):
#   vercel login            # once, opens a browser (pick "Continue with GitHub")
#   bash scripts/deploy-vercel.sh
#
set -uo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "ERROR: .env.local not found in $(pwd)" >&2
  exit 1
fi

# Load .env.local into the environment (quotes stripped, comments ignored).
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

# --- preflight -------------------------------------------------------------
if ! command -v vercel >/dev/null 2>&1; then
  echo "ERROR: vercel CLI not found. Install with: npm i -g vercel" >&2
  exit 1
fi
echo "==> Vercel account:"
if ! vercel whoami; then
  echo "ERROR: not logged in. Run 'vercel login' first (Continue with GitHub)." >&2
  exit 1
fi

: "${SELLER_ADDRESS:?SELLER_ADDRESS missing in .env.local}"
: "${UPSTASH_REDIS_REST_URL:?UPSTASH_REDIS_REST_URL missing in .env.local}"
: "${UPSTASH_REDIS_REST_TOKEN:?UPSTASH_REDIS_REST_TOKEN missing in .env.local}"
: "${GUARDRAIL_ADMIN_TOKEN:?GUARDRAIL_ADMIN_TOKEN missing in .env.local}"

# --- link (idempotent) -----------------------------------------------------
echo "==> Linking project (creates it on first run)..."
vercel link --yes >/dev/null

# --- env vars --------------------------------------------------------------
# Set a var on Production (remove first so re-runs don't error on "already exists").
set_env() {
  local name="$1" val="${2:-}"
  if [ -z "$val" ]; then echo "    - $name: (empty, skipped)"; return; fi
  vercel env rm "$name" production --yes >/dev/null 2>&1 || true
  printf '%s' "$val" | vercel env add "$name" production >/dev/null 2>&1
  echo "    - $name: set"
}

echo "==> Setting Production env vars (BUYER_PRIVATE_KEY is intentionally NOT uploaded)..."
set_env SELLER_ADDRESS            "$SELLER_ADDRESS"
set_env SELLER_PRIVATE_KEY        "${SELLER_PRIVATE_KEY:-}"
set_env GUARDRAIL_ADMIN_TOKEN     "$GUARDRAIL_ADMIN_TOKEN"
set_env UPSTASH_REDIS_REST_URL    "$UPSTASH_REDIS_REST_URL"
set_env UPSTASH_REDIS_REST_TOKEN  "$UPSTASH_REDIS_REST_TOKEN"

# --- deploy ----------------------------------------------------------------
echo "==> Deploying to production..."
vercel --prod --yes

echo
echo "==> Done. The Production URL is printed above (https://<project>.vercel.app)."
echo "    Next: tell Claude the URL, or run traction yourself:"
echo "      npm run research-agent -- --base <URL> --min-kya 0"
echo "      npm run traction"
