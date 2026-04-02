'use strict';

const fetch = require('node-fetch');
const config = require('../config');

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// ── Evolution API helpers ──────────────────────────────────────────────────

function useEvolution() {
  return !!(config.evolution.url && config.evolution.apiKey && config.evolution.instance);
}

async function callEvolution(endpoint, payload, wa_id) {
  const url = `${config.evolution.url}/${endpoint}/${config.evolution.instance}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': config.evolution.apiKey,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[responder/evo] ${endpoint} ${res.status} for ${wa_id}:`, body);
      return null;
    }
    const data = await res.json();
    return data?.key?.id || null;
  } catch (e) {
    console.error(`[responder/evo] network error (${endpoint}) for ${wa_id}:`, e.message);
    return null;
  }
}

async function evoSendText(to, text, options) {
  const payload = { number: to, text };
  if (options) payload.options = options;
  return callEvolution('message/sendText', payload, to);
}

/**
 * Attempt to send a text message to an @lid target using a fallback chain.
 * Strategy:
 * 1. Send using full @lid JID + quoted (references the original incoming message).
 * 2. If no lastMessageId available, try plain @lid without quoted.
 * 3. If both fail → log and return null.
 */
async function evoSendTextLidFallback(lidJid, text, lastMessageId) {
  const url = `${config.evolution.url}/message/sendText/${config.evolution.instance}`;

  if (lastMessageId) {
    console.log(`[responder/evo] @lid attempt 1: sending to ${lidJid} with quoted msgId=${lastMessageId}`);
    try {
      const payload = {
        number: lidJid,
        text,
        options: { checkIsWhatsApp: false, delay: 0 },
        quoted: {
          key: { id: lastMessageId, fromMe: false, remoteJid: lidJid },
          message: { conversation: '' }
        }
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'apikey': config.evolution.apiKey, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[responder/evo] @lid attempt 1 SUCCESS (quoted): sent to ${lidJid}`);
        return data?.key?.id || 'sent';
      }
      const body = await res.text();
      console.warn(`[responder/evo] @lid attempt 1 failed (${res.status}) for ${lidJid}:`, body);
    } catch (e) {
      console.warn(`[responder/evo] @lid attempt 1 network error for ${lidJid}:`, e.message);
    }
  }

  // Attempt 2: plain @lid without quoted
  console.log(`[responder/evo] @lid attempt 2: sending to full JID ${lidJid} without quoted`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'apikey': config.evolution.apiKey, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ number: lidJid, text, options: { checkIsWhatsApp: false, delay: 0 } })
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`[responder/evo] @lid attempt 2 SUCCESS: sent to ${lidJid}`);
      return data?.key?.id || 'sent';
    }
    const body = await res.text();
    console.warn(`[responder/evo] @lid attempt 2 failed (${res.status}) for ${lidJid}:`, body);
  } catch (e) {
    console.warn(`[responder/evo] @lid attempt 2 network error for ${lidJid}:`, e.message);
  }

  console.error(
    `[responder/evo] @lid delivery FAILED for ${lidJid} — message not delivered.\n` +
    `  lastMessageId was: ${lastMessageId || '(none — first contact)'}\n` +
    `  NOTE: The digits in @lid are a Meta internal ID, not a phone number.`
  );
  return null;
}

async function evoSendButtons(to, text, buttons) {
  if (!buttons || !buttons.length) return evoSendText(to, text);
  // Baileys no renderiza botones interactivos nativos — usar texto numerado
  const numbered = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
  return evoSendText(to, text + '\n\n' + numbered);
}

async function sendText(to, text, lastMessageId) {
  // Convertir _lid de vuelta a @lid para el fallback chain de Evolution API
  const isLid = to.endsWith('_lid');
  if (isLid) {
    const lidJid = to.replace('_lid', '@lid');
    console.log(`[responder] @lid target: attempting delivery for ${lidJid} (lastMessageId=${lastMessageId || 'none'})`);
    if (useEvolution()) {
      return evoSendTextLidFallback(lidJid, text, lastMessageId);
    }
    console.error(`[responder] @lid target ${lidJid} pero Evolution no configurado — mensaje descartado`);
    return null;
  }

  if (useEvolution()) {
    return evoSendText(to, text);
  }

  console.error(`[responder] sendText: Evolution no configurado — mensaje descartado para ${to}`);
  return null;
}

async function sendButtons(to, text, buttons, lastMessageId) {
  // @lid targets: Evolution no puede enviar botones interactivos — usar texto plano
  if (to.endsWith('_lid')) {
    const numbered = (buttons || []).map((b, i) => `${i + 1}. ${b.title}`).join('\n');
    return sendText(to, text + (numbered ? '\n\n' + numbered : ''), lastMessageId);
  }
  if (!buttons || !buttons.length) return sendText(to, text);

  if (useEvolution()) {
    return evoSendButtons(to, text, buttons);
  }

  console.error(`[responder] sendButtons: Evolution no configurado — mensaje descartado para ${to}`);
  return null;
}

module.exports = { sendText, sendButtons };
