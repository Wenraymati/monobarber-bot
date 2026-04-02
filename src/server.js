'use strict';

require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const db = require('./db/db');
const { seedAvailability } = require('./availability/seed');
const { reloadActiveSessions } = require('./bot/session');
const webhookRouter = require('./bot/webhook');
const dashboardRouter = require('./dashboard/router');
const { checkAndSendReminders } = require('./notifications/reminder');

// ── Inicializar DB ────────────────────────────────────────────────────────────
db.initDb(config.dbPath);

// ── Seed disponibilidad para demo (próximos 14 días) ─────────────────────────
seedAvailability();

// ── Recargar sesiones activas en memoria ──────────────────────────────────────
reloadActiveSessions();

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();

// Railway corre detrás de un proxy — necesario para express-rate-limit
app.set('trust proxy', 1);

// Parsear JSON con UTF-8
app.use(express.json({
  charset: 'utf-8',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// Cookie parser para dashboard auth
app.use(cookieParser());

// ── Rate limiting ─────────────────────────────────────────────────────────────
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests',
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts',
});

// ── Health check (sin auth) ───────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), instance: config.evolution.instance });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/webhook', webhookLimiter, webhookRouter);
app.use('/dashboard/login', loginLimiter);
app.use('/dashboard', dashboardRouter);

// Redirect raíz al dashboard
app.get('/', (req, res) => res.redirect('/dashboard'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Error handler global
app.use((err, req, res, next) => {
  console.error('[server] unhandled error:', err.message);
  res.status(500).json({ error: 'internal_error' });
});

// ── Process error handlers ────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException:', err.message);
  process.exit(1);
});

// ── Schedulers ────────────────────────────────────────────────────────────────

// Recordatorios cada 5 minutos
setInterval(() => {
  checkAndSendReminders().catch(err =>
    console.error('[scheduler] reminder error:', err.message)
  );
}, 5 * 60 * 1000);

// Limpiar sesiones expiradas en DB cada hora
setInterval(() => {
  db.cleanupSessions();
}, 60 * 60 * 1000);

// Re-seed disponibilidad diariamente a las 6am Santiago (UTC-3 = 9 UTC)
function scheduleDailySeed() {
  const now = new Date();
  const next6am = new Date(now);
  next6am.setUTCHours(9, 0, 0, 0);
  if (next6am <= now) next6am.setDate(next6am.getDate() + 1);
  const ms = next6am.getTime() - now.getTime();
  setTimeout(() => {
    seedAvailability();
    scheduleDailySeed(); // re-schedule para el día siguiente
  }, ms);
}
scheduleDailySeed();

// ── Start server ──────────────────────────────────────────────────────────────
const port = config.port;
app.listen(port, () => {
  console.log(`[server] Monobarber Bot corriendo en puerto ${port} (${config.nodeEnv})`);
  console.log(`[server] Dashboard: http://localhost:${port}/dashboard`);
  console.log(`[server] Webhook:   http://localhost:${port}/webhook`);
  console.log(`[server] Evolution instance: ${config.evolution.instance}`);
});

module.exports = app;
