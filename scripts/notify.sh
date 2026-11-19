#!/bin/sh
# Uso: scripts/notify.sh "Título" "Descripción"
# Lee NOTIFY_TOKEN (y opcionalmente NOTIFY_URL) del entorno o del .env.
set -e
cd "$(dirname "$0")/.."
[ -f .env ] && . ./.env
URL="${NOTIFY_URL:-http://localhost:${PORT:-3000}}"
TITLE="${1:?Falta el título}"
BODY="${2:-}"

# Escapa comillas y barras para el JSON
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{printf "%s%s", (NR>1?"\\n":""), $0}'; }

curl -sf -X POST "$URL/api/notify" \
  -H "Authorization: Bearer $NOTIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"$(esc "$TITLE")\",\"body\":\"$(esc "$BODY")\"}" \
  && echo "Enviado"
