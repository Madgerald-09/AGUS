#!/usr/bin/env bash
# Enter a Gemini key without placing it in terminal shell history or Git.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
if [[ ! -f .env.local ]]; then
  echo "Start the preview once before configuring Gemini."
  exit 1
fi
printf "Paste the Gemini API key (input will be hidden): "
IFS= read -r -s key
printf "\n"
if [[ ! "$key" =~ ^[A-Za-z0-9_-]{16,256}$ ]]; then
  echo "That doesn't resemble a Gemini API key. No file was changed."
  exit 2
fi
sed -i '/^AI_API_KEY=/d;/^AI_PROVIDER=/d;/^AI_MODEL=/d' .env.local
printf 'AI_PROVIDER=gemini\nAI_MODEL=gemini-3.5-flash-lite\nAI_API_KEY=%s\n' "$key" >> .env.local
chmod 600 .env.local
unset key
echo "Gemini has been configured in the ignored private .env.local file."
echo "Stop and restart this Codespace to restart the AGUS server with the key."
echo "Never commit .env.local or make port 3000 public."
