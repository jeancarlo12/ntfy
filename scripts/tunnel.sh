#!/bin/bash
# Abre o reutiliza un túnel HTTPS (Cloudflare) para instalar/vincular/sincronizar la app en el iPhone.
# Uso:
#   scripts/tunnel.sh         abre el túnel en segundo plano (o reutiliza el que ya esté activo) y muestra URL + código
#   scripts/tunnel.sh --fg    igual, pero en primer plano (se cierra con Ctrl-C)
#   scripts/tunnel.sh --stop  cierra el túnel en segundo plano
#
# Si defines TUNNEL_TOKEN y TUNNEL_URL en .env (Cloudflare Named Tunnel), usa siempre tu dominio fijo.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
need cloudflared "Instálalo con: brew install cloudflared"
need jq ""

PID_FILE="$NTFY_DIR/.tunnel.pid"
URL_FILE="$NTFY_DIR/.tunnel-url"
LOG_FILE="$NTFY_DIR/.tunnel.log"

stop_tunnel() {
  if [ -f "$PID_FILE" ]; then
    old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [ -n "$old_pid" ] && kill "$old_pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE" "$URL_FILE" "$LOG_FILE"
}

if [ "${1:-}" = "--stop" ]; then
  stop_tunnel
  echo "Túnel cerrado."
  exit 0
fi

MODE="bg"
[ "${1:-}" = "--fg" ] && MODE="fg"

curl -fsS --max-time 3 "$NOTIFY_URL/api/health" >/dev/null 2>&1 || {
  echo "El servidor no responde en $NOTIFY_URL. Arráncalo: scripts/service.sh install server" >&2
  exit 1
}

url=""
pid=""

# Si ya hay un túnel corriendo, reutilízalo para no cambiar la URL de la PWA
if [ -f "$PID_FILE" ] && [ -f "$URL_FILE" ]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  old_url="$(cat "$URL_FILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && [ -n "$old_url" ] && kill -0 "$old_pid" 2>/dev/null; then
    url="$old_url"
    pid="$old_pid"
    echo "→ Reutilizando túnel activo (PID $pid): $url"
  fi
fi

if [ -z "$url" ]; then
  stop_tunnel
  if [ -n "${TUNNEL_TOKEN:-}" ] && [ -n "${TUNNEL_URL:-}" ]; then
    nohup cloudflared tunnel --no-autoupdate run --token "$TUNNEL_TOKEN" >"$LOG_FILE" 2>&1 &
    pid=$!
    url="${TUNNEL_URL%/}"
  else
    nohup cloudflared tunnel --no-autoupdate --url "$NOTIFY_URL" >"$LOG_FILE" 2>&1 &
    pid=$!
    for _ in $(seq 1 60); do
      url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" | grep -v '^https://api\.' | head -n1 || true)"
      [ -n "$url" ] && break
      kill -0 "$pid" 2>/dev/null || { echo "cloudflared terminó:" >&2; tail -n 20 "$LOG_FILE" >&2; exit 1; }
      sleep 1
    done
    [ -n "$url" ] || { echo "cloudflared no dio una URL en 60 s:" >&2; tail -n 20 "$LOG_FILE" >&2; stop_tunnel; exit 1; }
  fi
  printf '%s\n' "$pid" > "$PID_FILE"
  printf '%s\n' "$url" > "$URL_FILE"

  printf '→ Esperando a que %s responda' "$url"
  ok=0
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 "$url/api/health" >/dev/null 2>&1; then ok=1; break; fi
    printf '.'; sleep 2
  done
  echo
  [ "$ok" = 1 ] || echo "Aviso: la URL aún no responde (DNS nuevo). Prueba en el iPhone en un minuto."
fi

code="$(api_curl POST /api/pair/new | jq -r .code)"
printf '%s' "$url" | pbcopy 2>/dev/null || true

cat <<EOF

================================================================
URL:     $url   (copiada al portapapeles)
Código:  $code   (un solo uso, 10 minutos)

En el iPhone:
 1. Abre la URL en Safari.
 2. Compartir → "Añadir a pantalla de inicio" → Añadir.
 3. Abre "Avisos" DESDE EL ICONO (no desde Safari).
 4. Escribe el código → Vincular → Activar notificaciones → Permitir.
 5. Toca "Probar notificación (5s)" y bloquea la pantalla.

¿Código vencido? Ejecuta: scripts/pair-code.sh
El túnel queda activo en 2º plano (no pierde su URL al hacer git pull o reiniciar el servidor).
Para cerrarlo cuando quieras: scripts/tunnel.sh --stop
================================================================
EOF
if command -v qrencode >/dev/null 2>&1; then qrencode -t ansiutf8 "$url"; fi

if [ "$MODE" = "fg" ]; then
  trap 'stop_tunnel; echo; echo "Túnel cerrado."; exit 0' INT TERM EXIT
  wait "$pid"
fi
