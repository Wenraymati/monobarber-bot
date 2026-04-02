'use strict';

const { google } = require('googleapis');

// Retorna null si no está configurado — no crashea el bot
function getCalendarClient() {
  const { GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CALENDAR_ID } = process.env;
  if (!GOOGLE_SERVICE_ACCOUNT_JSON || !GOOGLE_CALENDAR_ID) return null;
  try {
    const creds = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    return { calendar: google.calendar({ version: 'v3', auth }), calendarId: GOOGLE_CALENDAR_ID };
  } catch (e) {
    console.warn('[calendarSync] Error inicializando Google Calendar:', e.message);
    return null;
  }
}

async function createCalendarEvent({ clientName, date, time }) {
  const client = getCalendarClient();
  if (!client) return null; // No configurado, ignorar silenciosamente

  // Parsear fecha y hora (Chile UTC-3)
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  // Evento en hora local Chile (offset -03:00)
  const startDateTime = `${date}T${time}:00-03:00`;
  const endDate = new Date(year, month - 1, day, hour, minute + 45); // 45 min slot
  const endHH = String(endDate.getHours()).padStart(2, '0');
  const endMM = String(endDate.getMinutes()).padStart(2, '0');
  const endDateTime = `${date}T${endHH}:${endMM}:00-03:00`;

  const event = {
    summary: `💈 ${clientName || 'Cliente'} — Monobarber`,
    description: `Reserva WhatsApp\nCliente: ${clientName}`,
    start: { dateTime: startDateTime, timeZone: 'America/Santiago' },
    end: { dateTime: endDateTime, timeZone: 'America/Santiago' },
    colorId: '5', // banana yellow
  };

  try {
    const res = await client.calendar.events.insert({
      calendarId: client.calendarId,
      resource: event,
    });
    console.log(`[calendarSync] Evento creado: ${res.data.htmlLink}`);
    return res.data.id;
  } catch (e) {
    console.error('[calendarSync] Error creando evento:', e.message);
    return null;
  }
}

async function deleteCalendarEvent(eventId) {
  const client = getCalendarClient();
  if (!client || !eventId) return;
  try {
    await client.calendar.events.delete({ calendarId: client.calendarId, eventId });
    console.log(`[calendarSync] Evento eliminado: ${eventId}`);
  } catch (e) {
    console.error('[calendarSync] Error eliminando evento:', e.message);
  }
}

module.exports = { createCalendarEvent, deleteCalendarEvent };
