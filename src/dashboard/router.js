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

// Build an array of { date, label, count, bookings } for the next `days` days starting today
function buildAgendaDays(daysCount) {
  const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  const today = new Date();
  // Use local date parts to avoid UTC-offset drift
  const pad = n => String(n).padStart(2, '0');
  const toDateStr = d =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const startDate = toDateStr(today);
  const endDay = new Date(today);
  endDay.setDate(endDay.getDate() + daysCount - 1);
  const endDate = toDateStr(endDay);

  // Single DB query for the whole range
  const allBookings = db.getBookingsByDateRange(startDate, endDate);

  // Group by date
  const byDate = {};
  for (const b of allBookings) {
    if (!byDate[b.date]) byDate[b.date] = [];
    byDate[b.date].push(b);
  }

  const result = [];
  for (let i = 0; i < daysCount; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = toDateStr(d);
    const bookings = byDate[dateStr] || [];
    const dayName = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : DAYS_ES[d.getDay()];
    const label = `${dayName} ${d.getDate()} ${MONTHS_ES[d.getMonth()]}`;
    result.push({ date: dateStr, label, count: bookings.length, bookings });
  }
  return result;
}

// GET /dashboard — agenda principal (7 dias)
router.get('/', authMiddleware, (req, res) => {
  const days = buildAgendaDays(7);
  const clients = db.getFrequentClients(10);
  res.send(buildDashboardHTML(days, clients));
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

// GET /dashboard/api/today — backward-compatible: JSON de reservas de hoy
router.get('/api/today', authMiddleware, (req, res) => {
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const bookings = db.getBookingsForDay(today);
  res.json({ date: today, count: bookings.length, bookings });
});

// GET /dashboard/api/agenda — JSON de los proximos 7 dias
router.get('/api/agenda', authMiddleware, (req, res) => {
  const days = buildAgendaDays(7);
  res.json({ days });
});

// GET /dashboard/api/clients — clientes frecuentes
router.get('/api/clients', authMiddleware, (req, res) => {
  const clients = db.getFrequentClients(10);
  res.json({ clients });
});

function buildDashboardHTML(days, clients = []) {
  // Total reservas hoy
  const todayCount = days[0] ? days[0].count : 0;

  const sectionsHTML = days.map((day, idx) => {
    const isToday = idx === 0;
    const headingClass = isToday ? 'day-heading day-today' : 'day-heading';

    const rows = day.bookings.map(b => `
      <tr>
        <td><strong>${b.time}</strong></td>
        <td>${b.client_name || '<em>Sin nombre</em>'}</td>
        <td><span class="badge ${b.status}">${b.status === 'confirmed' ? 'Confirmado' : b.status}</span></td>
        <td class="reminders">${b.reminded_24h ? '✅' : '⏳'} / ${b.reminded_1h ? '✅' : '⏳'}</td>
        <td><button onclick="cancelBooking(${b.id})" class="btn-cancel">Cancelar</button></td>
      </tr>
    `).join('');

    const tableOrEmpty = day.bookings.length === 0
      ? '<p class="empty">Sin reservas</p>'
      : `<table>
          <thead><tr>
            <th>Hora</th><th>Cliente</th><th>Estado</th>
            <th>Recordat. 24h/1h</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
         </table>`;

    return `
      <div class="section">
        <h2 class="${headingClass}">
          ${day.label}
          ${day.count > 0 ? `<span class="count-badge">${day.count}</span>` : ''}
        </h2>
        ${tableOrEmpty}
      </div>`;
  }).join('');

  // Sección clientes frecuentes
  const clientRows = clients.map(c => `
    <tr>
      <td><strong>${c.visits}</strong></td>
      <td>${c.client_name || '<em>Desconocido</em>'}</td>
      <td>${c.last_visit || '—'}</td>
    </tr>
  `).join('');

  const clientsSection = `
    <div class="section">
      <h2 class="day-heading">Clientes frecuentes</h2>
      ${clients.length === 0
        ? '<p class="empty">Sin datos aún</p>'
        : `<table>
            <thead><tr>
              <th>Visitas</th><th>Nombre</th><th>Último turno</th>
            </tr></thead>
            <tbody>${clientRows}</tbody>
           </table>`
      }
    </div>`;

  return `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>💈 Monobarber — Agenda</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #1a1a1a; color: #e0e0e0; padding: 1rem; }
  header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  h1 { color: #d4a944; font-size: 1.5rem; }
  .header-stat { background: #2a2a2a; border-radius: 8px; padding: 0.4rem 0.9rem; font-size: 0.85rem; color: #aaa; }
  .header-stat strong { color: #d4a944; font-size: 1.1rem; }
  h2.day-heading { color: #aaa; font-size: 0.9rem; font-weight: 400; margin: 1rem 0 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
  h2.day-today { color: #d4a944; font-weight: 600; }
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
  .section { margin-bottom: 1.75rem; }
  .count-badge { background: #d4a944; color: #1a1a1a; font-weight: 700; padding: 0.1rem 0.5rem; border-radius: 10px; font-size: 0.8rem; margin-left: 0.5rem; }
</style>
</head>
<body>
<header>
  <h1>💈 Monobarber — Próximos 7 días</h1>
  <div class="header-stat">Hoy: <strong>${todayCount}</strong> reserva${todayCount !== 1 ? 's' : ''}</div>
</header>

${sectionsHTML}

${clientsSection}

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
