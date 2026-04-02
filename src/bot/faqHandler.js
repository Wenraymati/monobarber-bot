'use strict';

const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

// Load barberInfo once at module load
const barberInfoPath = path.join(__dirname, '../../knowledge/barberInfo.json');
const barberInfo = JSON.parse(fs.readFileSync(barberInfoPath, 'utf8'));

// Patterns that should be handled by the state machine, not by FAQ
const MENU_PATTERN = /^\s*([1-9]|si|sí|no|cancelar|hola|buenas|buenos días|buenos dias|buenas tardes|buenas noches)\s*$/i;

/**
 * Build the system prompt injecting all barbershop info from barberInfo.json.
 */
function buildSystemPrompt() {
  const { business, barber, schedule, services } = barberInfo;

  const servicesList = services
    .map(s => `- ${s.name}: $${s.price.toLocaleString('es-CL')} CLP`)
    .join('\n');

  const daysMap = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const openDays = (schedule.days_open || []).map(d => daysMap[d]).join(', ');

  return `Sos el asistente virtual de ${business.name} — "${business.tagline}".
Tu única función es responder preguntas sobre esta barbería y animar al cliente a reservar.

INFORMACIÓN DE LA BARBERÍA:
- Nombre: ${business.name}
- Dirección: ${business.address}
- Instagram: ${business.instagram}
- Barbero: ${barber.name}
- Horario de atención: ${schedule.open} a ${schedule.close}
- Días de trabajo: ${openDays}
- Duración de cada turno: ${schedule.slot_duration_minutes} minutos

SERVICIOS Y PRECIOS:
${servicesList}

INSTRUCCIONES:
- Respondé en español, de forma amigable y concisa (máximo 3 oraciones).
- Solo respondé preguntas relacionadas con la barbería (servicios, precios, horarios, ubicación, cómo reservar).
- Si la pregunta no tiene nada que ver con la barbería, redirigí gentilmente al menú de reservas.
- SIEMPRE terminá tu respuesta con esta llamada a la acción exacta: "¿Querés reservar tu turno? Escribí *1* 💈"
- No inventes información que no esté en los datos anteriores.`;
}

/**
 * Call Gemini Flash REST API and return the text response.
 * @param {string} apiKey
 * @param {string} userText
 * @returns {Promise<string>}
 */
async function callGemini(apiKey, userText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: {
      parts: [{ text: buildSystemPrompt() }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userText }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 256,
      temperature: 0.4,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: 8000,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini returned empty response');
  }

  return text.trim();
}

/** Static fallback when Gemini is unavailable */
const STATIC_FALLBACK =
  'Para reservar tu turno escribí *1*, para ver tu reserva *2* o para cancelar *3* 💈';

/**
 * Handle a free-text message that doesn't match the booking menu.
 *
 * @param {string} waId       - WhatsApp user ID
 * @param {string} userText   - Raw message text from the user
 * @param {Function} sendMessage - async (waId, text) => void
 * @returns {Promise<boolean>} true if handled (dispatcher should skip state machine),
 *                             false if dispatcher should handle normally
 */
async function handleFaq(waId, userText, sendMessage) {
  const normalized = (userText || '').trim();

  // Let the state machine handle menu selections and greetings
  if (MENU_PATTERN.test(normalized)) {
    return false;
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('[faqHandler] GEMINI_API_KEY not set — using static fallback');
    await sendMessage(waId, STATIC_FALLBACK);
    return true;
  }

  try {
    const reply = await callGemini(apiKey, normalized);
    await sendMessage(waId, reply);
    return true;
  } catch (err) {
    console.error('[faqHandler] Gemini call failed:', err.message, { waId });
    await sendMessage(waId, STATIC_FALLBACK);
    return true;
  }
}

module.exports = { handleFaq };
