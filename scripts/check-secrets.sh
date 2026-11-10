#!/usr/bin/env bash
# AI Lead Qualification & Routing — fails if the repository contains a key, a secret,
# a real spreadsheet / script / form-handler ID, or a personal email address.
# Runs in CI on every push and pull request.   Run locally: bash scripts/check-secrets.sh
set -uo pipefail

# Skip binary images and lock files
mapfile -t FILES < <(git ls-files | grep -v -E '\.(png|jpe?g|gif|ico|webp|svg)$|package-lock\.json$')

fail=0
report() { echo "  $1"; fail=1; }
self='^scripts/check-secrets\.sh:'

# 1) Keys, tokens and private keys
SECRET_RE='rnd_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(ant-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}|"private_key_id"|"refresh_token" *: *"1//|api=[A-Za-z0-9]{12,}'
hits=$(grep -n -I -E "$SECRET_RE" -- "${FILES[@]}" 2>/dev/null | grep -v -E "$self")
[ -n "$hits" ] && { echo "Possible keys or tokens:"; while IFS= read -r l; do report "$(echo "$l" | cut -d: -f1-2)"; done <<< "$hits"; }

# 2) Real deployment details: Apps Script / spreadsheet IDs, live web-app URLs, form handlers
if [ -f .clasp.json ] && grep -q -E '"scriptId" *: *"1[A-Za-z0-9_-]{40,}"' .clasp.json; then
  report ".clasp.json  real scriptId (use REPLACE_WITH_APPS_SCRIPT_ID)"
fi
DEPLOY_RE='[0-9]{10,13}-compute@developer\.gserviceaccount\.com|script\.google\.com/macros/s/AKfy[A-Za-z0-9_-]{20,}|docs\.google\.com/spreadsheets/d/1[A-Za-z0-9_-]{40,}|"1[A-Za-z0-9_-]{43}"|/l/[0-9]{6,}/'
hits=$(grep -n -I -E "$DEPLOY_RE" -- "${FILES[@]}" 2>/dev/null | grep -v -E "$self")
[ -n "$hits" ] && { echo "Possible real deployment details:"; while IFS= read -r l; do report "$(echo "$l" | cut -d: -f1-2)"; done <<< "$hits"; }

# 3) Email addresses: only made-up ones are allowed
EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
ALLOWED_RE='@(example\.(com|org|net)|[A-Za-z0-9.-]+\.example|users\.noreply\.github\.com|anthropic\.com|cursor\.com)$'
while IFS= read -r line; do
  file=${line%%:*}; rest=${line#*:}; num=${rest%%:*}; email=${rest#*:}
  [ "$file" = "scripts/check-secrets.sh" ] && continue
  if ! [[ "$email" =~ $ALLOWED_RE ]]; then report "$file:$num  personal-looking email address (use a made-up one, e.g. someone@example.com)"; fi
done < <(grep -n -o -I -E "$EMAIL_RE" -- "${FILES[@]}" 2>/dev/null)

if [ "$fail" -ne 0 ]; then
  echo "❌ Secrets check failed. Replace the values above with placeholders or made-up examples."
  exit 1
fi
echo "✅ No keys, secrets, real IDs or personal email addresses found in ${#FILES[@]} files."
