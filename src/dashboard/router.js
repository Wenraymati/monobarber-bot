'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const db = require('../db/db');
const config = require('../config');

const router = express.Router();

// Auth middleware simple basado en cookie o query token
function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.query?.token;
  if (token === config.dashboard.token) return next();
  const redirectPath = encodeURIComponent(req.path);
  res.redirect(`/dashboard/login?redirect=${redirectPath}`);
}

// GET /dashboard/login
router.get('/login', (req, res) => {
  const error = req.query.error ? '<p style="color:#e55;margin:0">Contraseña incorrecta</p>' : '';
  res.send(`
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><title>Monobarber Dashboard</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      *{box-sizing:border-box}
      body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a1a}
      form{background:#2a2a2a;padding:2rem;border-radius:10px;color:white;width:100%;max-width:320px}
      h2{color:#d4a944;margin:0 0 1rem}
      input,button{width:100%;padding:0.75rem;margin:0.4rem 0;border-radius:6px;border:1px solid #444;background:#333;color:white;font-size:1rem}
      button{background:#d4a944;border:none;cursor:pointer;font-weight:600;color:#1a1a1a}
      button:hover{background:#e0b84f}
    </style>
    </head><body>
    <form method="POST" action="/dashboard/login">
      <h2>💈 Monobarber</h2>
      ${error}
      <input type="password" name="token" placeholder="Contraseña" required autofocus>
      <button type="submit">Entrar</button>
    </form></body></html>
  `);
});

// POST /dashboard/login
router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.token === config.dashboard.token) {
    res.cookie('token', req.body.token, { httpOnly: true, maxAge: 86400000 });
    const redirect = req.query.redirect || '/dashboard';
    res.redirect(redirect);
  } else {
    res.redirect('/dashboard/login?error=1');
  }
});

// GET /dashboard — agenda principal
router.get('/', authMiddleware, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const todayBookings = db.getBookingsForDay(today);

  // Próximos 3 días
  const upcoming = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const bookings = db.getBookingsForDay(dateStr);
    if (bookings.length > 0) upcoming.push({ date: dateStr, bookings });
  }

  res.send(buildDashboardHTML(today, todayBookings, upcoming));
});

// POST /dashboard/api/cancel/:id — cancelar reserva desde dashboard
router.post('/api/cancel/:id', authMiddleware, express.json(), (req, res) => {
  const booking = db.getDb().prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'No encontrado' });
  db.cancelBooking(booking.id);
  db.markSlotAvailable(booking.date, booking.time);
  console.log(`[dashboard] Reserva #${booking.id} cancelada desde dashboard`);
  res.json({ ok: true });
});

// GET /dashboard/api/today — JSON de reservas de hoy (para integración externa)
router.get('/api/today', authMiddleware, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const bookings = db.getBookingsForDay(today);
  res.json({ date: today, count: bookings.length, bookings });
});

function buildDashboardHTML(today, todayBookings, upcoming) {
  const rows = todayBookings.map(b => `
    <tr>
      <td><strong>${b.time}</strong></td>
      <td>${b.client_name || '<em>Sin nombre</em>'}</td>
      <td><span class="badge ${b.status}">${b.status === 'confirmed' ? 'Confirmado' : b.status}</span></td>
      <td class="reminders">${b.reminded_24h ? '✅' : '⏳'} / ${b.reminded_1h ? '✅' : '⏳'}</td>
      <td><button onclick="cancelBooking(${b.id})" class="btn-cancel">Cancelar</button></td>
    </tr>
  `).join('');

  const upcomingHTML = upcoming.map(({ date, bookings }) => `
    <div class="upcoming-day">
      <h3>${date}</h3>
      <div class="slots">
        ${bookings.map(b => `<div class="slot"><strong>${b.time}</strong> — ${b.client_name || 'Sin nombre'}</div>`).join('')}
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>💈 Monobarber — Agenda</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #1a1a1a; color: #e0e0e0; padding: 1rem; }
  header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem; }
  h1 { color: #d4a944; font-size: 1.5rem; }
  h2 { color: #aaa; font-size: 0.9rem; font-weight: 400; margin: 1rem 0 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
  h3 { color: #888; font-size: 0.85rem; margin-bottom: 0.4rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th { background: #2a2a2a; padding: 0.6rem 0.75rem; text-align: left; color: #d4a944; font-size: 0.8rem; text-transform: uppercase; }
  td { padding: 0.6rem 0.75rem; border-bottom: 1px solid #2a2a2a; }
  tr:hover td { background: #222; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .badge.confirmed { background: #1a5c2a; color: #5dba6f; }
  .badge.cancelled { background: #5c1a1a; color: #ba5d5d; }
  .reminders { color: #777; font-size: 0.8rem; }
  .btn-cancel { background: #5c1a1a; color: #e0a0a0; border: none; padding: 0.3rem 0.6rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem; }
  .btn-cancel:hover { background: #7a2020; }
  .empty { color: #555; font-style: italic; font-size: 0.9rem; padding: 0.5rem 0; }
  .upcoming-day { margin-bottom: 1rem; }
  .slots { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .slot { padding: 0.35rem 0.7rem; background: #2a2a2a; border-radius: 4px; font-size: 0.85rem; }
  .section { margin-bottom: 2rem; }
  .count-badge { background: #d4a944; color: #1a1a1a; font-weight: 700; padding: 0.1rem 0.5rem; border-radius: 10px; font-size: 0.8rem; margin-left: 0.5rem; }
</style>
</head>
<body>
<header>
  <h1>💈 Monobarber</h1>
</header>

<div class="section">
  <h2>Agenda de hoy — ${today} <span class="count-badge">${todayBookings.length}</span></h2>
  ${todayBookings.length === 0
    ? '<p class="empty">Sin reservas para hoy</p>'
    : `<table>
        <thead><tr>
          <th>Hora</th><th>Cliente</th><th>Estado</th>
          <th>Recordat. 24h/1h</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
       </table>`
  }
</div>

<div class="section">
  <h2>Próximos días</h2>
  ${upcoming.length === 0
    ? '<p class="empty">Sin reservas en los próximos 3 días</p>'
    : upcomingHTML
  }
</div>

<script>
async function cancelBooking(id) {
  if (!confirm('¿Cancelar esta reserva?')) return;
  try {
    const res = await fetch('/dashboard/api/cancel/' + id, { method: 'POST' });
    if (res.ok) {
      location.reload();
    } else {
      alert('Error al cancelar la reserva');
    }
  } catch (e) {
    alert('Error de red: ' + e.message);
  }
}
</script>
</body></html>`;
}

module.exports = router;
