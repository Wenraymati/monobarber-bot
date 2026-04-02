'use strict';

const config = require('../config');
const db = require('../db/db');

/**
 * Genera slots de disponibilidad para los próximos 14 días.
 * Solo crea los slots que no existen (INSERT OR IGNORE).
 * Garantiza que la demo siempre tenga disponibilidad.
 */
function seedAvailability() {
  const { open, close, slot_duration_minutes, days_open } = config.barber.schedule;

  const [openH, openM] = open.split(':').map(Number);
  const [closeH, closeM] = close.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  let slotsCreated = 0;

  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    const dayOfWeek = d.getDay(); // 0=Dom, 1=Lun, ...

    if (!days_open.includes(dayOfWeek)) continue;

    const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD

    for (let m = openMinutes; m < closeMinutes; m += slot_duration_minutes) {
      const h = Math.floor(m / 60).toString().padStart(2, '0');
      const min = (m % 60).toString().padStart(2, '0');
      const timeStr = `${h}:${min}`;
      db.insertSlot(dateStr, timeStr);
      slotsCreated++;
    }
  }

  console.log(`[seed] ${slotsCreated} slots de disponibilidad generados/verificados para los próximos 14 días`);
}

module.exports = { seedAvailability };
