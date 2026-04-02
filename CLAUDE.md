# CLAUDE.md — Monobarber Bot

## Sesión nombrada
```bash
cd C:/Users/Mati/proyectos/monobarber-bot
claude -n monobarber
```

## Proyecto
Bot WhatsApp de reservas para barbería Daniel (Monobarber). Integra Evolution API v2 con flujo de booking de 5 pasos, dashboard admin, FAQ con Gemini, y recordatorios automáticos.

**Producción:** https://monobarber-bot-production.up.railway.app
**GitHub:** https://github.com/Wenraymati/monobarber-bot
**Deploy:** Railway (autodeploy desde `master`)

## Stack
- **Runtime:** Node.js 22, CommonJS
- **DB:** SQLite (better-sqlite3, WAL mode) → volumen persistente en Railway
- **WhatsApp:** Evolution API v2 en `api.smartproia.com` (instancia `monobarber`)
- **IA:** Gemini 2.0 Flash (FAQ) — clave activa en Railway
- **Dashboard:** `/dashboard` (token cookie, dark mode #1a1a1a/#d4a944)

## Estructura clave
```
src/
├── server.js          # Express + schedulers (5min/60min/6am)
├── config.js          # Carga .env + barberInfo.json
├── bot/
│   ├── webhook.js     # Normalización Evolution + dedup + @lid resolution
│   ├── dispatcher.js  # Router principal con session lock
│   ├── bookingFlow.js # FSM 6 estados
│   ├── responder.js   # envío Evolution API
│   ├── faqHandler.js  # Gemini integration
│   └── session.js     # Memory + DB persistence
├── db/
│   ├── db.js          # SQLite API
│   └── schema.sql     # tablas: availability, bookings, sessions, settings
├── notifications/
│   ├── reminder.js    # Recordatorios 24h/1h
│   └── ownerAlert.js  # Alerta al dueño
├── availability/seed.js # Slots 14 días
└── dashboard/router.js  # Admin panel
knowledge/
└── barberInfo.json    # Config barbería (horarios, precios, mensajes)
```

## Variables de entorno (Railway)
```bash
EVOLUTION_API_URL=https://api.smartproia.com
EVOLUTION_API_KEY=smartproia-evo-2026
EVOLUTION_INSTANCE=monobarber
EVOLUTION_WEBHOOK_SECRET=28365ccb99a223ea6a50e1a50f109197
OWNER_WA_NUMBER=<número WA del dueño>
DASHBOARD_TOKEN=mono-a27f82798bc58893
GEMINI_API_KEY=AIzaSyA6jrXhyglfZxmj121kJT2u2YuLcXSLALY
PORT=3000
NODE_ENV=production
DB_PATH=/data/bookings.db
```

## Flujo booking (6 estados FSM)
```
IDLE → MAIN_MENU → SELECTING_DATE → SELECTING_TIME → CAPTURING_NAME → CONFIRMING_BOOKING
```
- Confirmación acepta `1` (confirmar) o `2` (cambiar), NO texto libre
- FAQ intercepta en IDLE/MAIN_MENU cuando no hay match de menú
- Session lock evita race conditions por mensajes simultáneos

## Nota crítica: @lid (linked-device)
Evolution API puede enviar sender como `@lid` (Meta internal ID, no número real).
Resolver con 4 fases fallback en `webhook.js`. Sin resolver → bot responde a ID roto → mensaje no llega.

## Deploy
```bash
git push origin master  # autodeploy Railway
```
- Railway token: `9bbf60cb-3143-4978-8846-8397e8135347` (claude-code-monobarber, creado 2026-04-02)
- Healthcheck: `/health`
- DB en volumen `/data/bookings.db` — NO se pierde en redeploy

## Testing manual (webhook simulado)
```bash
curl -s -X POST https://monobarber-bot-production.up.railway.app/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: 28365ccb99a223ea6a50e1a50f109197" \
  -d '{"event":"messages.upsert","data":{"key":{"remoteJid":"56900000001@s.whatsapp.net","fromMe":false,"id":"TEST001"},"message":{"conversation":"hola"},"messageTimestamp":1000000000}}'
```

## Reglas para esta sesión
- No usar `sleep` encadenados en tests — saturan el contexto
- Tests simples: una ronda de curl, verificar agenda, listo
- Para cambios de código: delegar a `backend-architect` agent
- Secrets presentes en este archivo son de dev/staging, no producción crítica
