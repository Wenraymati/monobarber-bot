'use strict';

const config = require('../config');
const db = require('../db/db');
const { sendText } = require('./responder');
const {
  STATES,
  getNextBusinessDays,
  formatDate,
  getMainMenuText,
  getDateSelectionText,
  getTimeSelectionText,
  getConfirmationText,
  parseSelection,
  isCancelCommand,
  isGreeting,
  isConfirmCommand,
  isDenyCommand,
} = require('./bookingFlow');
const { notifyOwner } = require('../notifications/ownerAlert');
const { handleFaq } = require('./faqHandler');

/**
 * Procesa un mensaje entrante y retorna { reply, newState, newContext }
 * @param {string} waId
 * @param {string} text
 * @param {object} session
 */
async function handleMessage(waId, text, session) {
  const state = session ? session.state : STATES.IDLE;
  const ctx = session ? (session.context_json || {}) : {};

  // ── Global: CANCELAR desde cualquier estado ───────────────────────────────────
  // Si está a mitad de un flujo, cancela el flujo Y la reserva activa si existe.
  // Si está en IDLE/MAIN_MENU, cancela la reserva activa si existe, o informa que no hay ninguna.
  if (isCancelCommand(text)) {
    const booking = db.getActiveBooking(waId);
    if (booking) {
      db.cancelBooking(booking.id);
      db.markSlotAvailable(booking.date, booking.time);
      return {
        reply: config.barber.messages.cancelled_ok,
        newState: STATES.IDLE,
        newContext: {},
      };
    }
    // Sin reserva activa — informar y volver al menú solo si estaba en un flujo
    if (state !== STATES.IDLE && state !== STATES.MAIN_MENU) {
      return {
        reply: config.barber.messages.no_booking + '\n\n' + getMainMenuText(),
        newState: STATES.MAIN_MENU,
        newContext: {},
      };
    }
    // En IDLE/MAIN_MENU sin reserva activa
    return {
      reply: config.barber.messages.no_booking + '\n\n' + getMainMenuText(),
      newState: STATES.MAIN_MENU,
      newContext: {},
    };
  }

  // ── Global: saludo siempre reinicia al menú ───────────────────────────────────
  if (isGreeting(text)) {
    return {
      reply: getMainMenuText(),
      newState: STATES.MAIN_MENU,
      newContext: {},
    };
  }

  switch (state) {
    case STATES.IDLE:
    case STATES.MAIN_MENU: {
      const sel = parseSelection(text, 3);

      if (sel === 0) {
        // 1 = Reservar hora
        const days = getNextBusinessDays(6);
        if (days.length === 0) {
          return {
            reply: 'No hay días disponibles próximamente. Volvé a intentar más tarde.',
            newState: STATES.MAIN_MENU,
            newContext: {},
          };
        }
        return {
          reply: getDateSelectionText(days),
          newState: STATES.SELECTING_DATE,
          newContext: { days },
        };
      }

      if (sel === 1) {
        // 2 = Ver reserva
        const booking = db.getActiveBooking(waId);
        if (!booking) {
          return {
            reply: config.barber.messages.no_booking + '\n\n' + getMainMenuText(),
            newState: STATES.MAIN_MENU,
            newContext: {},
          };
        }
        const reply = `📋 *Tu reserva:*\n📅 ${formatDate(booking.date)} — ${booking.time}\n💈 ${config.barber.business.name}\n📍 ${config.barber.business.address}\n\nPara cancelar escribí *CANCELAR*`;
        return { reply, newState: STATES.MAIN_MENU, newContext: {} };
      }

      if (sel === 2) {
        // 3 = Cancelar turno
        const booking = db.getActiveBooking(waId);
        if (!booking) {
          return {
            reply: config.barber.messages.no_booking + '\n\n' + getMainMenuText(),
            newState: STATES.MAIN_MENU,
            newContext: {},
          };
        }
        db.cancelBooking(booking.id);
        db.markSlotAvailable(booking.date, booking.time);
        return {
          reply: config.barber.messages.cancelled_ok,
          newState: STATES.IDLE,
          newContext: {},
        };
      }

      // No entendió — mostrar menú de nuevo
      return {
        reply: getMainMenuText(),
        newState: STATES.MAIN_MENU,
        newContext: {},
      };
    }

    case STATES.SELECTING_DATE: {
      const days = ctx.days || [];
      const sel = parseSelection(text, days.length);

      if (sel === null) {
        return {
          reply: `Por favor elegí un número del 1 al ${days.length} 👆\n\n` + getDateSelectionText(days),
          newState: STATES.SELECTING_DATE,
          newContext: ctx,
        };
      }

      const selectedDay = days[sel];
      const slots = db.getAvailableSlots(selectedDay.date);

      if (slots.length === 0) {
        return {
          reply: config.barber.messages.no_availability + '\n\n' + getDateSelectionText(days),
          newState: STATES.SELECTING_DATE,
          newContext: ctx,
        };
      }

      const slotTimes = slots.map(s => s.time);
      return {
        reply: getTimeSelectionText(slotTimes, selectedDay.date),
        newState: STATES.SELECTING_TIME,
        newContext: { ...ctx, selectedDate: selectedDay.date, slots: slotTimes },
      };
    }

    case STATES.SELECTING_TIME: {
      const slots = ctx.slots || [];
      const sel = parseSelection(text, slots.length);

      if (sel === null) {
        return {
          reply: `Por favor elegí un número del 1 al ${slots.length} 👆`,
          newState: STATES.SELECTING_TIME,
          newContext: ctx,
        };
      }

      const selectedTime = slots[sel];
      return {
        reply: '¿Cuál es tu nombre para la reserva? ✍️',
        newState: STATES.CAPTURING_NAME,
        newContext: { ...ctx, selectedTime },
      };
    }

    case STATES.CAPTURING_NAME: {
      const name = (text || '').trim();
      if (name.length < 2) {
        return {
          reply: 'Por favor ingresá tu nombre 😊',
          newState: STATES.CAPTURING_NAME,
          newContext: ctx,
        };
      }
      const newCtx = { ...ctx, clientName: name };
      return {
        reply: getConfirmationText(newCtx),
        newState: STATES.CONFIRMING_BOOKING,
        newContext: newCtx,
      };
    }

    case STATES.CONFIRMING_BOOKING: {
      if (isConfirmCommand(text)) {
        // Confirmar reserva
        // Verificar que el slot sigue disponible
        const stillAvailable = db.getAvailableSlots(ctx.selectedDate)
          .some(s => s.time === ctx.selectedTime);

        if (!stillAvailable) {
          const days = getNextBusinessDays(6);
          return {
            reply: '⚠️ Lo sentimos, ese horario ya no está disponible. Elegí otro:\n\n' + getDateSelectionText(days),
            newState: STATES.SELECTING_DATE,
            newContext: { days },
          };
        }

        // Guardar reserva
        db.createBooking({
          waId,
          clientName: ctx.clientName,
          serviceId: 'corte',
          date: ctx.selectedDate,
          time: ctx.selectedTime,
        });
        db.markSlotBooked(ctx.selectedDate, ctx.selectedTime);

        const confirmMsg = `✅ ¡Reserva confirmada, ${ctx.clientName}!\n\n📅 ${formatDate(ctx.selectedDate)} — ${ctx.selectedTime}\n📍 ${config.barber.business.address}\n💈 ${config.barber.business.name}\n\nTe recordaremos antes de tu cita 🔔\nPara cancelar escribí *CANCELAR*`;

        // Notificar al dueño (sin await para no bloquear la respuesta al cliente)
        notifyOwner({
          clientName: ctx.clientName,
          date: ctx.selectedDate,
          time: ctx.selectedTime,
        });

        return {
          reply: confirmMsg,
          newState: STATES.IDLE,
          newContext: {},
        };
      }

      if (isDenyCommand(text)) {
        // Cambiar fecha/hora
        const days = getNextBusinessDays(6);
        return {
          reply: 'Sin problema, ¿qué día preferís?\n\n' + getDateSelectionText(days),
          newState: STATES.SELECTING_DATE,
          newContext: { days },
        };
      }

      // Respuesta no reconocida — repetir confirmación
      return {
        reply: getConfirmationText(ctx),
        newState: STATES.CONFIRMING_BOOKING,
        newContext: ctx,
      };
    }

    default:
      return {
        reply: getMainMenuText(),
        newState: STATES.MAIN_MENU,
        newContext: {},
      };
  }
}

/**
 * Entry point para mensajes de texto.
 * Usa withSessionLock para serializar mensajes del mismo usuario.
 */
async function handleText(waId, text, messageId) {
  const { withSessionLock, getSession, updateSession } = require('./session');

  await withSessionLock(waId, async () => {
    const session = getSession(waId);
    const state = session ? session.state : 'IDLE';

    // ── FAQ fallback: only intercept when user is not mid-booking flow ───────────
    const isIdleState = state === 'IDLE' || state === 'MAIN_MENU';
    if (isIdleState) {
      const sendFn = (id, msg) => sendText(id, msg, messageId);
      const handled = await handleFaq(waId, text, sendFn);
      if (handled) return;
    }

    try {
      const result = await handleMessage(waId, text, session);

      // Actualizar sesión
      updateSession(waId, {
        state: result.newState,
        context_json: result.newContext,
      });

      // Enviar respuesta
      if (result.reply) {
        const lastMessageId = session.context_json?.last_message_id || messageId;
        await sendText(waId, result.reply, lastMessageId);
      }
    } catch (err) {
      console.error('[dispatcher] handleText error:', err.message, { waId });
      try {
        await sendText(waId, 'Ocurrió un error inesperado. Por favor intentá de nuevo.');
      } catch (_) {}
    }
  });
}

/**
 * Entry point para respuestas de botones (mismo flujo que texto).
 */
async function handleButtonReply(waId, buttonId, buttonTitle, messageId) {
  return handleText(waId, buttonTitle || buttonId, messageId);
}

module.exports = { handleText, handleButtonReply };
