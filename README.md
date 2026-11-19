# Avisos push (Rust + Web Push)

Recibe avisos por `POST` (p. ej. desde Claude Code) y los envía como push a tu iPhone (PWA). Cada aviso: título + descripción.

## 1. Generar claves VAPID
```sh
cargo run --bin gen_keys
```
Copia las 3 líneas que imprime.

## 2. Configurar `.env`
```sh
cp .env.example .env
```
Pega las claves y cambia `VAPID_SUBJECT` (tu email) y `NOTIFY_TOKEN` (un secreto largo). `PORT` es opcional (3000).

## 3. Ejecutar
```sh
cargo run
```
Abre http://localhost:3000.

## 4. iPhone
Web Push en iOS exige **HTTPS** y PWA instalada (iOS 16.4+). Publica el servidor con HTTPS (p. ej. un túnel como Cloudflare Tunnel o Tailscale Funnel), abre la URL en Safari → Compartir → *Añadir a pantalla de inicio*, abre la app desde el icono y toca **Activar notificaciones**.

## 5. Enviar avisos
```sh
curl -X POST localhost:3000/api/notify \
  -H "Authorization: Bearer $NOTIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Prueba","body":"Hola"}'
```
O con el script (lee `.env`; usa `NOTIFY_URL` si el servidor es remoto):
```sh
scripts/notify.sh "Claude Code" "Tarea terminada"
```
Sin token o con token incorrecto la API responde `401`.

## 6. Conectar con Claude Code
Puedes disparar un aviso automático cuando Claude Code termine una tarea o pida atención añadiendo un hook en `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/Users/howdy/ntfy/scripts/notify.sh \"Claude Code\" \"Tarea terminada\""
          }
        ]
      }
    ]
  }
}
```
Si el servidor está en otra URL, añade `NOTIFY_URL=https://tu-url ` delante del comando.

## Datos
Se guardan en `data.json` (máx. 100 avisos). Todo el acceso está en `src/storage.rs`, para poder cambiarlo a Redis.
