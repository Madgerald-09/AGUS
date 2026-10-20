#!/usr/bin/env bash
# Starts a private, fixture-only AGUS preview in GitHub Codespaces.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p .data
if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
fi
chmod 600 .env.local

# Every restart reasserts the no-real-money safety boundary.
set_env() {
  local name="$1" value="$2"
  sed -i "/^${name}=/d" .env.local
  printf '%s=%s\n' "$name" "$value" >> .env.local
}
set_env PAYMENT_MODE fixture
set_env FINANCIAL_DEMO_ENABLED true
set_env PAYSTACK_SECRET_KEY ""
set_env PAYSTACK_TRANSFERS_ENABLED false
set_env LIVE_TRANSFERS_ENABLED false
set_env LIVE_OWNER_AUTHORIZED false
set_env LIVE_WEBHOOK_VALIDATED false
set_env LIVE_RECONCILIATION_VALIDATED false
set_env LIVE_BENEFICIARY_ALLOWLIST ""
set_env PAYMENTS_EMERGENCY_DISABLED false
set_env DATABASE_URL "pglite://.data/agent"
if [[ -n "${CODESPACE_NAME:-}" ]]; then
  set_env APP_ORIGIN "https://${CODESPACE_NAME}-3000.app.github.dev"
else
  set_env APP_ORIGIN "http://localhost:3000"
fi

# Codespaces secrets are distinct from GitHub Actions repository secrets.
# Never write an injected Codespaces secret to disk or echo it.
key="${AGUS_GEMINI_API_KEY:-${GEMINI_API_KEY:-${AI_API_KEY:-${GOOGLE_API_KEY:-}}}}"
if [[ -n "$key" ]]; then
  export AI_API_KEY="$key"
  set_env AI_PROVIDER gemini
  set_env AI_MODEL gemini-3.5-flash-lite
elif grep -Eq '^AI_API_KEY=[^[:space:]]+' .env.local; then
  set_env AI_PROVIDER gemini
  set_env AI_MODEL gemini-3.5-flash-lite
else
  set_env AI_PROVIDER none
fi

# The operator has a unique random password per Codespace, never a shared default.
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
let env = readFileSync(".env.local", "utf8");
if (!/^OPERATOR_PASSWORD_HASH=[^\s]+/m.test(env)) {
  const password = randomBytes(21).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const hash = salt + ":" + scryptSync(password, salt, 64).toString("hex");
  env = env.replace(/^OPERATOR_PASSWORD_HASH=.*$/m, "OPERATOR_PASSWORD_HASH=" + hash);
  writeFileSync(".env.local", env, { mode: 0o600 });
  writeFileSync(".data/preview-login.txt",
    "AGUS v1.2 PRIVATE FIXTURE PREVIEW\nOperator ID: demo-operator\nPassword: " +
    password + "\n\nDo not share this password or publish port 3000.\n",
    { mode: 0o600 });
}
NODE

# Embedded PGlite requires only one process. Do not migrate a running server.
if [[ -f .data/preview.pid ]] && kill -0 "$(cat .data/preview.pid)" 2>/dev/null; then
  echo "AGUS preview appears to be running already."
  exit 0
fi

npm run db:migrate
export NEXT_TELEMETRY_DISABLED=1
nohup npm run dev -- --port 3000 >> .data/preview.log 2>&1 < /dev/null &
echo "$!" > .data/preview.pid

echo "AGUS private fixture preview starting on port 3000."
echo "Open the forwarded AGUS port in Codespaces (keep visibility Private)."
echo "In the Codespaces terminal run: cat .data/preview-login.txt"
if [[ -z "$key" ]] && ! grep -Eq '^AI_API_KEY=[^[:space:]]+' .env.local; then
  echo "Gemini is not configured in this Codespace; see .devcontainer/PREVIEW.md."
fi
