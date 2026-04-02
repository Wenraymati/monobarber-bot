'use strict';

const crypto = require('crypto');
const fetch = require('node-fetch');
const express = require('express');
const router = express.Router();
const config = require('../config');
const responder = require('./responder');

// ── Message deduplication ─────────────────────────────────────────────────────
// Evolution API puede disparar el mismo webhook 2+ veces para el mismo mensaje
const processedIds = new Map(); // messageId → timestamp
const DEDUP_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

function isDuplicate(messageId) {
  if (!messageId) return false;
  const now = Date.now();
  for (const [id, ts] of processedIds) {
    if (now - ts > DEDUP_TTL_MS) processedIds.delete(id);
  }
  if (processedIds.has(messageId)) return true;
  processedIds.set(messageId, now);
  return false;
}

const processedContentHashes = new Map(); // contentHash → timestamp
const CONTENT_DEDUP_TTL_MS = 3 * 1000; // 3 segundos

function isDuplicateContent(wa_id, content) {
  if (!content) return false;
  const hash = crypto.createHash('md5').update(`${wa_id}:${content}`).digest('hex');
  const now = Date.now();
  for (const [h, ts] of processedContentHashes) {
    if (now - ts > CONTENT_DEDUP_TTL_MS) processedContentHashes.delete(h);
  }
  if (processedContentHashes.has(hash)) return true;
  processedContentHashes.set(hash, now);
  return false;
}

// ── @lid resolution ───────────────────────────────────────────────────────────
// Evolution API v2.2.x con Baileys en linked-device mode asigna JIDs @lid.
// Estrategia de resolución (4 fases) — igual que gymbot.

const lidCache = new Map(); // lid → phone number

function picBase(url) {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return url.split('?')[0]; }
}

async function resolveLid(lid, senderJid, senderPn) {
  if (lidCache.has(lid)) return lidCache.get(lid);

  // Fase 0: contact/fetchProfile con el @lid crudo
  try {
    const url = `${config.evolution.url}/contact/fetchProfile/${config.evolution.instance}`;
    const candidates = [lid, lid.replace(/@lid$/, '')];
    for (const candidate of candidates) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'apikey': config.evolution.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: candidate })
      });
      if (res.ok) {
        const profile = await res.json();
        const raw = profile?.wuid || profile?.id || profile?.phone || profile?.number || profile?.jid;
        if (raw) {
          const digits = String(raw).replace(/@\S+$/, '').replace(/\D/g, '');
          if (/^\d{10,15}$/.test(digits)) {
            lidCache.set(lid, digits);
            console.log(`[webhook/evo] @lid ${lid} → ${digits} (via contact/fetchProfile fase 0)`);
            return digits;
          }
        }
      }
    }
  } catch (e) {
    console.warn('[webhook/evo] contact/fetchProfile fase 0 error:', e.message);
  }

  // Fase 0.5: key.senderPn
  if (senderPn) {
    const pn = senderPn.endsWith('@s.whatsapp.net')
      ? senderPn.replace('@s.whatsapp.net', '')
      : senderPn.replace(/\D/g, '');
    if (/^\d{10,15}$/.test(pn)) {
      lidCache.set(lid, pn);
      console.log(`[webhook/evo] @lid ${lid} → ${pn} (via key.senderPn fase 0.5)`);
      return pn;
    }
  }

  // Fase 1: data.sender con JID real
  if (senderJid && senderJid.endsWith('@s.whatsapp.net')) {
    const phone = senderJid.replace('@s.whatsapp.net', '');
    lidCache.set(lid, phone);
    console.log(`[webhook/evo] @lid ${lid} → ${phone} (via sender JID)`);
    return phone;
  }

  // Fase 2: cross-reference profilePicUrl CDN path
  try {
    const contactsUrl = `${config.evolution.url}/chat/findContacts/${config.evolution.instance}`;
    const contactsRes = await fetch(contactsUrl, {
      method: 'POST',
      headers: { 'apikey': config.evolution.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { remoteJid: lid } })
    });
    let lidPicPath = null;
    if (contactsRes.ok) {
      const contacts = await contactsRes.json();
      if (Array.isArray(contacts) && contacts.length > 0) {
        lidPicPath = picBase(contacts[0].profilePicUrl);
      }
    }

    if (lidPicPath) {
      try {
        const allContactsRes = await fetch(`${config.evolution.url}/chat/findContacts/${config.evolution.instance}`, {
          method: 'POST',
          headers: { 'apikey': config.evolution.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        if (allContactsRes.ok) {
          const allContacts = await allContactsRes.json();
          if (Array.isArray(allContacts)) {
            for (const c of allContacts) {
              if (!c.remoteJid || !c.remoteJid.endsWith('@s.whatsapp.net')) continue;
              const phone = c.remoteJid.replace('@s.whatsapp.net', '');
              if (!/^\d{10,15}$/.test(phone)) continue;
              const cPicPath = picBase(c.profilePicUrl);
              if (cPicPath && cPicPath === lidPicPath) {
                lidCache.set(lid, phone);
                console.log(`[webhook/evo] @lid ${lid} → ${phone} (via contacts picUrl cross-reference)`);
                return phone;
              }
            }
          }
        }
      } catch (e) {
        console.warn('[webhook/evo] @lid contacts picUrl resolution error:', e.message);
      }
    }
  } catch (e) {
    console.warn('[webhook/evo] @lid resolution error (phase 2):', e.message);
  }

  // Fase 3: historial de mensajes entrantes
  try {
    const msgsUrl = `${config.evolution.url}/chat/findMessages/${config.evolution.instance}`;
    const msgsRes = await fetch(msgsUrl, {
      method: 'POST',
      headers: { 'apikey': config.evolution.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { key: { remoteJid: lid } }, limit: 10 })
    });
    if (msgsRes.ok) {
      const msgsData = await msgsRes.json();
      const records = msgsData?.messages?.records || (Array.isArray(msgsData) ? msgsData : []);
      for (const r of records) {
        const senderField = r?.data?.sender || r?.sender || '';
        if (senderField && senderField.endsWith('@s.whatsapp.net')) {
          const phone = senderField.replace('@s.whatsapp.net', '');
          lidCache.set(lid, phone);
          console.log(`[webhook/evo] @lid ${lid} → ${phone} (via message history sender field)`);
          return phone;
        }
        const participant = r?.key?.participant || '';
        if (participant && participant.endsWith('@s.whatsapp.net')) {
          const phone = participant.replace('@s.whatsapp.net', '');
          lidCache.set(lid, phone);
          console.log(`[webhook/evo] @lid ${lid} → ${phone} (via message history participant field)`);
          return phone;
        }
      }
    }
  } catch (e) {
    console.warn('[webhook/evo] @lid resolution error (phase 3 - message history):', e.message);
  }

  // Fase 4: sin resolución — responder enviará via JID directo
  return null;
}

// GET /webhook — Meta hub.challenge verification
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.evolution.webhookSecret) {
    console.log('[webhook] verification successful');
    return res.status(200).send(challenge);
  }
  console.warn('[webhook] verification failed — token mismatch');
  return res.sendStatus(403);
});

/**
 * Normalize Evolution API v2 webhook → array of internal message objects
 * { wa_id, text, buttonId, buttonTitle, messageId }
 */
async function normalizeEvolution(body) {
  if (body.event !== 'messages.upsert') return null;

  const data = body.data;
  if (!data) return null;

  const key = data.key || {};

  // Ignorar mensajes propios (fromMe:true)
  if (key.fromMe === true) {
    return null;
  }

  const remoteJid = key.remoteJid || '';

  // Ignorar grupos
  if (remoteJid.endsWith('@g.us')) {
    console.log(`[webhook/evo] grupo ignorado: ${remoteJid.split('@')[0]}`);
    return null;
  }

  // Resolver número real desde JID
  let wa_id;
  if (remoteJid.endsWith('@s.whatsapp.net')) {
    wa_id = remoteJid.replace(/@s\.whatsapp\.net$/, '');
  } else if (remoteJid.endsWith('@lid')) {
    const senderJid = data.sender || key.participant || '';
    const senderPn = key.senderPn || null;
    const resolved = await resolveLid(remoteJid, senderJid, senderPn);
    if (resolved) {
      wa_id = resolved;
    } else {
      wa_id = remoteJid.replace('@lid', '_lid');
    }
  } else {
    console.warn('[webhook/evo] JID no reconocido, ignorando:', remoteJid);
    return null;
  }
  if (!wa_id) return null;

  const messageId = key.id || null;

  if (isDuplicate(messageId)) {
    return null;
  }

  const msgPayload = data.message || {};

  // Desenvolver contenedores ephemeral/viewOnce
  const innerMsg = msgPayload.ephemeralMessage?.message
    || msgPayload.viewOnceMessage?.message
    || msgPayload.viewOnceMessageV2?.message?.viewOnceMessage?.message
    || msgPayload;

  // Button reply
  if (innerMsg.buttonsResponseMessage) {
    const br = innerMsg.buttonsResponseMessage;
    if (isDuplicateContent(wa_id, br.selectedButtonId)) {
      console.info(`[DEDUP] Mensaje descartado por duplicado (button)`, { wa_id });
      return null;
    }
    return [{
      wa_id,
      messageId,
      text:        null,
      buttonId:    br.selectedButtonId    || null,
      buttonTitle: br.selectedDisplayText || null,
    }];
  }

  // List reply
  if (innerMsg.listResponseMessage) {
    const lr = innerMsg.listResponseMessage;
    if (isDuplicateContent(wa_id, lr.singleSelectReply?.selectedRowId)) {
      console.info(`[DEDUP] Mensaje descartado por duplicado (list)`, { wa_id });
      return null;
    }
    return [{
      wa_id,
      messageId,
      text:        null,
      buttonId:    lr.singleSelectReply?.selectedRowId || null,
      buttonTitle: lr.title || null,
    }];
  }

  // Texto plano
  const text =
    innerMsg.conversation ||
    innerMsg.extendedTextMessage?.text ||
    null;

  if (!text) {
    const msgKeys = Object.keys(msgPayload).join(',');
    console.log(`[webhook/evo] no text — msgPayload keys: ${msgKeys || '(empty)'} wa_id=${wa_id}`);
    return null;
  }

  if (isDuplicateContent(wa_id, text)) {
    console.info(`[DEDUP] Mensaje descartado por duplicado (text)`, { wa_id });
    return null;
  }

  return [{ wa_id, messageId, text, buttonId: null, buttonTitle: null }];
}

// POST /webhook — mensajes entrantes
router.post('/', async (req, res) => {
  const body = req.body;

  // ── Non-upsert Evolution events — ack inmediato ───────────────────────────
  const SILENT_EVENTS = new Set([
    'messages.update', 'send.message',
    'groups.update', 'groups.upsert',
    'group-participants.update',
    'contacts.update', 'contacts.upsert',
    'chats.update', 'chats.upsert', 'chats.delete',
    'presence.update',
  ]);
  if (body && body.event && body.event !== 'messages.upsert') {
    if (!SILENT_EVENTS.has(body.event)) {
      console.log(`[webhook/evo] event: ${body.event}, data keys: ${Object.keys(body.data || {}).join(',')}`);
    }
    res.sendStatus(200);
    return;
  }

  // ── Evolution API v2 ──────────────────────────────────────────────────────
  if (body && body.event === 'messages.upsert') {
    // Verificación opcional del secret header
    const evoSecret = req.headers['x-evolution-secret'];
    const expectedSecret = config.evolution.webhookSecret;
    if (expectedSecret && evoSecret !== expectedSecret) {
      console.warn('[webhook/evo] secret mismatch — rejected');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Responder 200 inmediatamente antes de cualquier procesamiento async
    res.sendStatus(200);

    try {
      const messages = await normalizeEvolution(body);
      if (!messages) return;

      const dispatcher = require('./dispatcher');
      const session = require('./session');

      for (const msg of messages) {
        // Para contactos @lid: guardar el last_message_id en sesión para routing
        if (msg.wa_id.endsWith('_lid') && msg.messageId) {
          const sess = session.getSession(msg.wa_id);
          session.updateSession(msg.wa_id, {
            context_json: { ...(sess.context_json || {}), last_message_id: msg.messageId },
          });
          console.log(`[webhook/evo] @lid ${msg.wa_id}: saved last_message_id=${msg.messageId}`);
        }

        if (msg.buttonId) {
          dispatcher.handleButtonReply(msg.wa_id, msg.buttonId, msg.buttonTitle, msg.messageId).catch(e =>
            console.error('[webhook/evo] handleButtonReply error:', e.message, { wa_id: msg.wa_id })
          );
        } else if (msg.text) {
          dispatcher.handleText(msg.wa_id, msg.text, msg.messageId).catch(e =>
            console.error('[webhook/evo] handleText error:', e.message, { wa_id: msg.wa_id })
          );
        }
      }
    } catch (e) {
      console.error('[webhook/evo] parse error:', e.message);
    }

    return;
  }

  // ── Fallback: responder 200 para cualquier otro payload ───────────────────
  res.sendStatus(200);
});

module.exports = router;
