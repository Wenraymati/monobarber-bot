'use strict';

const config = require('../config');

const STATES = {
  IDLE:               'IDLE',
  MAIN_MENU:          'MAIN_MENU',
  SELECTING_DATE:     'SELECTING_DATE',
  SELECTING_TIME:     'SELECTING_TIME',
  CAPTURING_NAME:     'CAPTURING_NAME',
  CONFIRMING_BOOKING: 'CONFIRMING_BOOKING',
  CHECKING_BOOKING:   'CHECKING_BOOKING',
  CANCELLING:         'CANCELLING',
};

const DAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Genera los próximos N días hábiles según days_open en barberInfo.
 * days_open: array de días de semana (0=Dom, 1=Lun, ..., 6=Sáb)
 * Retorna array de objetos { index: 1, date: 'YYYY-MM-DD', label: 'lun 5 may' }
 */
function getNextBusinessDays(n = 6) {
  const { days_open } = config.barber.schedule;
  const result = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let checked = 0;
  let dayIndex = 1; // empezar desde mañana

  while (result.length < n && checked < 60) {
    const d = new Date(today);
    d.setDate(today.getDate() + dayIndex);
    const dow = d.getDay(); // 0=Dom, 1=Lun, ...

    if (days_open.includes(dow)) {
      const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
      const dayName = DAYS_ES[dow];
      const month = MONTHS_ES[d.getMonth()];
      const label = `${dayName} ${d.getDate()} ${month}`;
      result.push({ index: result.length + 1, date: dateStr, label });
    }

    dayIndex++;
    checked++;
  }

  return result;
}

/**
 * Formatea fecha 'YYYY-MM-DD' a texto legible 'lun 5 mayo'
 */
function formatDate(dateStr) {
  try {
    // Parsear como fecha local (evitar problemas de timezone)
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    const dow = d.getDay();
    const dayName = DAYS_ES[dow];
    const monthName = MONTHS_ES[d.getMonth()];
    return `${dayName} ${d.getDate()} ${monthName}`;
  } catch {
    return dateStr;
  }
}

/**
 * Formatea precio CLP: 8000 → '$8.000'
 */
function formatCLP(amount) {
  return '$' + Number(amount).toLocaleString('es-CL');
}

/**
 * Retorna el texto del menú principal
 */
function getMainMenuText() {
  return config.barber.messages.greeting;
}

/**
 * Retorna texto para selección de fecha con días disponibles
 */
function getDateSelectionText(days) {
  if (!days || days.length === 0) {
    return config.barber.messages.no_availability;
  }
  const lines = days.map(d => `${d.index}️⃣ ${d.label}`).join('\n');
  return `📅 ¿Qué día te queda mejor?\n\n${lines}\n\nEscribí el número de tu opción 👆`;
}

/**
 * Retorna texto para selección de hora con slots disponibles
 */
function getTimeSelectionText(slots, dateStr) {
  const dateLabel = formatDate(dateStr);
  const lines = slots.map((s, i) => `${i + 1}️⃣ ${s}`).join('\n');
  return `🕐 Horarios disponibles para *${dateLabel}*:\n\n${lines}\n\nEscribí el número de tu horario 👆`;
}

/**
 * Retorna texto de confirmación antes de guardar
 */
function getConfirmationText(context) {
  const dateLabel = formatDate(context.selectedDate || '');
  const name = context.clientName || '?';
  const time = context.selectedTime || '?';
  const businessName = config.barber.business.name;

  return `✅ Confirmá tu reserva:\n\n👤 Nombre: *${name}*\n📅 Día: *${dateLabel}*\n🕐 Hora: *${time}*\n💈 *${businessName}*\n\n1️⃣ Confirmar\n2️⃣ Cambiar fecha/hora`;
}

/**
 * Parsea selección numérica del usuario.
 * Retorna índice 0-based si el texto es un número válido dentro del rango, null si no.
 * @param {string} text
 * @param {number} maxOptions
 * @returns {number|null}
 */
function parseSelection(text, maxOptions) {
  const trimmed = (text || '').trim();
  const num = parseInt(trimmed, 10);
  if (isNaN(num)) return null;
  if (num < 1 || num > maxOptions) return null;
  return num - 1; // convertir a 0-based
}

/**
 * Verifica si el mensaje es "CANCELAR" (case insensitive)
 */
function isCancelCommand(text) {
  return /^cancelar$/i.test((text || '').trim());
}

/**
 * Verifica si el mensaje es un saludo/inicio
 */
function isGreeting(text) {
  return /^(hola|hi|buenas|buenos|buen|hey|ola|inicio|menu|start|menú)$/i.test((text || '').trim());
}

module.exports = {
  STATES,
  getNextBusinessDays,
  formatDate,
  formatCLP,
  getMainMenuText,
  getDateSelectionText,
  getTimeSelectionText,
  getConfirmationText,
  parseSelection,
  isCancelCommand,
  isGreeting,
};
