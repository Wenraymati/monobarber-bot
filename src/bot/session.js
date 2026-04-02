'use strict';

const db = require('../db/db');

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

const sessions = new Map(); // wa_id → SessionObj
const SESSION_TTL = 86400; // 24 horas en segundos

function createSession(wa_id) {
  const now = Math.floor(Date.now() / 1000);
  return {
    wa_id,
    state: STATES.IDLE,
    context_json: {},
    last_activity: now,
    created_at: now,
  };
}

function getSession(wa_id) {
  const now = Math.floor(Date.now() / 1000);

  // Revisar Map en memoria primero
  if (sessions.has(wa_id)) {
    const s = sessions.get(wa_id);
    if (now - s.last_activity > SESSION_TTL) {
      const fresh = createSession(wa_id);
      sessions.set(wa_id, fresh);
      return fresh;
    }
    return s;
  }

  // Intentar cargar desde DB
  const fromDb = db.getSessionFromDb(wa_id);
  if (fromDb) {
    if (now - fromDb.last_activity > SESSION_TTL) {
      const fresh = createSession(wa_id);
      sessions.set(wa_id, fresh);
      return fresh;
    }
    const sess = {
      ...fromDb,
      context_json: fromDb.context_json
        ? (typeof fromDb.context_json === 'string' ? JSON.parse(fromDb.context_json) : fromDb.context_json)
        : {},
    };
    sessions.set(wa_id, sess);
    return sess;
  }

  // Sesión nueva
  const fresh = createSession(wa_id);
  sessions.set(wa_id, fresh);
  return fresh;
}

function updateSession(wa_id, updates) {
  const session = getSession(wa_id);
  Object.assign(session, updates, { last_activity: Math.floor(Date.now() / 1000) });
  sessions.set(wa_id, session);
  db.upsertSession(session);
  return session;
}

function resetSession(wa_id) {
  const fresh = createSession(wa_id);
  sessions.set(wa_id, fresh);
  db.upsertSession(fresh);
  return fresh;
}

function reloadActiveSessions() {
  const cutoff = Math.floor(Date.now() / 1000) - SESSION_TTL;
  const rows = db.getActiveSessions(cutoff);
  for (const row of rows) {
    sessions.set(row.wa_id, {
      ...row,
      context_json: row.context_json
        ? (typeof row.context_json === 'string' ? JSON.parse(row.context_json) : row.context_json)
        : {},
    });
  }
  console.log(`[session] ${rows.length} sesiones activas recargadas`);
}

// Cleanup de sesiones expiradas en memoria (corre cada 5 min)
setInterval(() => {
  const cutoff = Math.floor(Date.now() / 1000) - SESSION_TTL;
  let removed = 0;
  for (const [wa_id, s] of sessions) {
    if (s.last_activity < cutoff) {
      sessions.delete(wa_id);
      removed++;
    }
  }
  if (removed) console.log(`[session] ${removed} sesiones expiradas eliminadas de memoria`);
}, 5 * 60 * 1000);

// Per-user processing lock — previene race condition cuando dos mensajes
// del mismo wa_id llegan antes de que alguno termine de procesarse.
const _processingLocks = new Map(); // wa_id → Promise

/**
 * Serializa el procesamiento async por usuario.
 * Envolvé el handler completo:
 *   await withSessionLock(wa_id, async () => { ...dispatch logic... });
 */
async function withSessionLock(wa_id, fn) {
  const prev = _processingLocks.get(wa_id) || Promise.resolve();
  const next = prev.then(() => fn()).finally(() => {
    if (_processingLocks.get(wa_id) === next) {
      _processingLocks.delete(wa_id);
    }
  });
  _processingLocks.set(wa_id, next);
  return next;
}

module.exports = {
  STATES,
  getSession,
  updateSession,
  resetSession,
  reloadActiveSessions,
  withSessionLock,
};
