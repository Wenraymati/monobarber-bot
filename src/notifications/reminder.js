'use strict';

const config = require('../config');
const db = require('../db/db');
const { sendText } = require('../bot/responder');

/**
 * Verifica y envía recordatorios de 24h y 1h a clientes con reservas próximas.
 * Se llama cada 5 minutos desde server.js.
 */
async function checkAndSendReminders() {
  const now = new Date();

  // Ventana 24h: entre 23h y 25h desde ahora
  const window24hStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const window24hEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  // Ventana 1h: entre 55min y 75min desde ahora
  const window1hStart = new Date(now.getTime() + 55 * 60 * 1000);
  const window1hEnd   = new Date(now.getTime() + 75 * 60 * 1000);

  // Convertir a formato 'YYYY-MM-DDTHH:MM' (sin segundos)
  const toISO = d => d.toISOString().slice(0, 16);

  // ── Recordatorios 24h ──────────────────────────────────────────────────────
  const reminders24h = db.getUpcomingBookingsNeedingReminder(
    toISO(window24hStart), toISO(window24hEnd), 'reminded_24h'
  );
  for (const booking of reminders24h) {
    const msg = `⏰ *Recordatorio Monobarber*\n\nHola ${booking.client_name}! Te recordamos que mañana tenés turno:\n\n📅 ${booking.date} — ${booking.time}\n📍 ${config.barber.business.address}\n\nSi no podés asistir, escribí *CANCELAR*`;
    try {
      await sendText(booking.wa_id, msg);
      db.markReminderSent(booking.id, 'reminded_24h');
      console.log(`[reminder] 24h enviado a ${booking.wa_id} (booking #${booking.id})`);
    } catch (err) {
      console.error(`[reminder] Error enviando 24h a ${booking.wa_id}:`, err.message);
    }
  }

  // ── Recordatorios 1h ───────────────────────────────────────────────────────
  const reminders1h = db.getUpcomingBookingsNeedingReminder(
    toISO(window1hStart), toISO(window1hEnd), 'reminded_1h'
  );
  for (const booking of reminders1h) {
    const msg = `⏰ *¡En 1 hora!*\n\nHola ${booking.client_name}! En 1 hora tenés turno en Monobarber:\n\n🕐 ${booking.time}\n📍 ${config.barber.business.address}\n\n¡Te esperamos! 💈`;
    try {
      await sendText(booking.wa_id, msg);
      db.markReminderSent(booking.id, 'reminded_1h');
      console.log(`[reminder] 1h enviado a ${booking.wa_id} (booking #${booking.id})`);
    } catch (err) {
      console.error(`[reminder] Error enviando 1h a ${booking.wa_id}:`, err.message);
    }
  }

  const total = reminders24h.length + reminders1h.length;
  if (total > 0) {
    console.log(`[reminder] Ciclo completado: ${reminders24h.length} x 24h, ${reminders1h.length} x 1h`);
  }
}

module.exports = { checkAndSendReminders };
