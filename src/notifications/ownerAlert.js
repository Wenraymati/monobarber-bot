'use strict';

const config = require('../config');
const { sendText } = require('../bot/responder');

/**
 * Notifica al peluquero por WhatsApp cuando llega una reserva nueva.
 * Fire-and-forget — no bloquea el flujo del cliente.
 */
function notifyOwner({ clientName, date, time }) {
  if (!config.owner.waNumber) {
    console.log('[ownerAlert] OWNER_WA_NUMBER no configurado — notificación omitida');
    return;
  }

  const msg = `📌 *Nueva reserva en Monobarber*\n\n👤 Cliente: ${clientName}\n📅 ${date} — ${time}\n\n💈 ¡Éxito!`;

  sendText(config.owner.waNumber, msg).catch(err => {
    console.error('[ownerAlert] Error notificando al dueño:', err.message);
  });
}

module.exports = { notifyOwner };
