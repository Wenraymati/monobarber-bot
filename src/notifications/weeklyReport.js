'use strict';

const config = require('../config');
const db = require('../db/db');

/**
 * Envía reporte semanal al dueño por email.
 * Incluye: bookings de la semana, cancelaciones, clientes nuevos, hora más demandada.
 */
async function sendWeeklyReport() {
  const resendKey = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;

  if (!resendKey || !ownerEmail) {
    console.log('[weeklyReport] RESEND_API_KEY o OWNER_EMAIL no configurados — omitiendo');
    return;
  }

  try {
    const now = new Date();
    // Rango: últimos 7 días
    const pad = n => String(n).padStart(2, '0');
    const toDateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

    const endDate = toDateStr(now);
    const startDay = new Date(now);
    startDay.setDate(startDay.getDate() - 7);
    const startDate = toDateStr(startDay);

    // Stats de la semana
    const allBookings = db.getBookingsByDateRange(startDate, endDate);
    const confirmed = allBookings.filter(b => b.status === 'confirmed');
    const cancelled = db.getDb()
      .prepare(`SELECT * FROM bookings WHERE status = 'cancelled' AND created_at >= ? ORDER BY date, time`)
      .all(startDay.toISOString());

    // Clientes únicos esta semana
    const uniqueClients = new Set(confirmed.map(b => b.wa_id)).size;

    // Hora más demandada
    const hourCount = {};
    for (const b of confirmed) {
      const h = b.time.slice(0, 5);
      hourCount[h] = (hourCount[h] || 0) + 1;
    }
    const topHour = Object.entries(hourCount).sort((a, b) => b[1] - a[1])[0];

    // Clientes frecuentes de la semana
    const freqClients = db.getFrequentClients(5);

    // Build HTML
    const bookingRows = confirmed.map(b => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #333">${b.date}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #333">${b.time}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #333">${b.client_name || '—'}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,sans-serif;background:#1a1a1a;color:#e0e0e0;padding:24px;max-width:600px;margin:0 auto">
  <h1 style="color:#d4a944;margin:0 0 4px">Monobarber — Reporte Semanal</h1>
  <p style="color:#777;margin:0 0 24px;font-size:0.9rem">${startDate} al ${endDate}</p>

  <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
    <div style="background:#2a2a2a;padding:16px 24px;border-radius:8px;flex:1;min-width:120px">
      <div style="font-size:2rem;font-weight:700;color:#d4a944">${confirmed.length}</div>
      <div style="color:#aaa;font-size:0.85rem">Reservas</div>
    </div>
    <div style="background:#2a2a2a;padding:16px 24px;border-radius:8px;flex:1;min-width:120px">
      <div style="font-size:2rem;font-weight:700;color:#e55">${cancelled.length}</div>
      <div style="color:#aaa;font-size:0.85rem">Cancelaciones</div>
    </div>
    <div style="background:#2a2a2a;padding:16px 24px;border-radius:8px;flex:1;min-width:120px">
      <div style="font-size:2rem;font-weight:700;color:#5ba">${uniqueClients}</div>
      <div style="color:#aaa;font-size:0.85rem">Clientes únicos</div>
    </div>
    ${topHour ? `<div style="background:#2a2a2a;padding:16px 24px;border-radius:8px;flex:1;min-width:120px">
      <div style="font-size:2rem;font-weight:700;color:#d4a944">${topHour[0]}</div>
      <div style="color:#aaa;font-size:0.85rem">Hora más pedida</div>
    </div>` : ''}
  </div>

  ${confirmed.length > 0 ? `
  <h2 style="color:#d4a944;font-size:1rem;margin:0 0 8px">Reservas de la semana</h2>
  <table style="width:100%;border-collapse:collapse;background:#2a2a2a;border-radius:8px;overflow:hidden;margin-bottom:24px">
    <thead><tr style="background:#333">
      <th style="padding:8px 12px;text-align:left;color:#d4a944;font-size:0.8rem">Fecha</th>
      <th style="padding:8px 12px;text-align:left;color:#d4a944;font-size:0.8rem">Hora</th>
      <th style="padding:8px 12px;text-align:left;color:#d4a944;font-size:0.8rem">Cliente</th>
    </tr></thead>
    <tbody>${bookingRows}</tbody>
  </table>` : '<p style="color:#777">Sin reservas esta semana.</p>'}

  <p style="color:#555;font-size:0.8rem;margin-top:32px">
    Generado automáticamente por Monobarber Bot · ${new Date().toLocaleString('es-CL')}
  </p>
</body></html>`;

    const { Resend } = require('resend');
    const resend = new Resend(resendKey);

    await resend.emails.send({
      from: 'Monobarber <noreply@smartproia.com>',
      to: ownerEmail,
      subject: `Resumen semanal — ${confirmed.length} reservas (${startDate})`,
      html,
    });

    console.log(`[weeklyReport] Enviado a ${ownerEmail}: ${confirmed.length} reservas, ${cancelled.length} cancelaciones`);
  } catch (err) {
    console.error('[weeklyReport] Error:', err.message);
    // No relanzar
  }
}

module.exports = { sendWeeklyReport };
