'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

function initDb(dbPath) {
  // Crear directorio si no existe
  const resolvedPath = path.resolve(dbPath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -8000');

  // Cargar y ejecutar schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  console.log('[db] Inicializada en', resolvedPath);
  return db;
}

function getDb() {
  if (!db) throw new Error('DB no inicializada. Llamar initDb() primero.');
  return db;
}

// --- Availability ---

function getAvailableSlots(date) {
  return getDb()
    .prepare('SELECT time FROM availability WHERE date = ? AND is_available = 1 ORDER BY time')
    .all(date);
}

function markSlotBooked(date, time) {
  getDb()
    .prepare('UPDATE availability SET is_available = 0 WHERE date = ? AND time = ?')
    .run(date, time);
}

function markSlotAvailable(date, time) {
  getDb()
    .prepare('UPDATE availability SET is_available = 1 WHERE date = ? AND time = ?')
    .run(date, time);
}

// Insertar slots si no existen (para seed)
function insertSlot(date, time) {
  getDb()
    .prepare('INSERT OR IGNORE INTO availability (date, time, is_available) VALUES (?, ?, 1)')
    .run(date, time);
}

// --- Bookings ---

function createBooking({ waId, clientName, serviceId, date, time }) {
  const result = getDb()
    .prepare(`INSERT INTO bookings (wa_id, client_name, service_id, date, time, status)
              VALUES (?, ?, ?, ?, ?, 'confirmed')`)
    .run(waId, clientName, serviceId || 'corte', date, time);
  return result.lastInsertRowid;
}

function getActiveBooking(waId) {
  return getDb()
    .prepare(`SELECT * FROM bookings WHERE wa_id = ? AND status = 'confirmed' ORDER BY date, time LIMIT 1`)
    .get(waId);
}

function cancelBooking(bookingId) {
  getDb()
    .prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?")
    .run(bookingId);
}

function getBookingsForDay(date) {
  return getDb()
    .prepare(`SELECT * FROM bookings WHERE date = ? AND status = 'confirmed' ORDER BY time`)
    .all(date);
}

function getUpcomingBookingsNeedingReminder(windowStart, windowEnd, reminderField) {
  const col = reminderField === 'reminded_24h' ? 'reminded_24h' : 'reminded_1h';
  return getDb()
    .prepare(`SELECT * FROM bookings
              WHERE status = 'confirmed'
              AND ${col} = 0
              AND (date || 'T' || time) >= ?
              AND (date || 'T' || time) <= ?`)
    .all(windowStart, windowEnd);
}

function markReminderSent(bookingId, reminderField) {
  const col = reminderField === 'reminded_24h' ? 'reminded_24h' : 'reminded_1h';
  getDb()
    .prepare(`UPDATE bookings SET ${col} = 1 WHERE id = ?`)
    .run(bookingId);
}

// --- Sessions ---

function getSessionFromDb(waId) {
  return getDb()
    .prepare('SELECT * FROM sessions WHERE wa_id = ?')
    .get(waId);
}

function upsertSession(sess) {
  const context_json = typeof sess.context_json === 'string'
    ? sess.context_json
    : JSON.stringify(sess.context_json || {});

  getDb()
    .prepare(`INSERT INTO sessions (wa_id, state, context_json, last_activity)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(wa_id) DO UPDATE SET
                state = excluded.state,
                context_json = excluded.context_json,
                last_activity = excluded.last_activity`)
    .run(sess.wa_id, sess.state, context_json, sess.last_activity || Math.floor(Date.now() / 1000));
}

function getActiveSessions(cutoff) {
  return getDb()
    .prepare('SELECT * FROM sessions WHERE last_activity > ?')
    .all(cutoff);
}

// Limpiar sesiones inactivas (>24h)
function cleanupSessions() {
  const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const result = getDb()
    .prepare('DELETE FROM sessions WHERE last_activity < ?')
    .run(cutoff);
  if (result.changes > 0) console.log(`[db] Sesiones expiradas eliminadas: ${result.changes}`);
}

// --- Settings ---

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  getDb()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, String(value));
}

module.exports = {
  initDb,
  getDb,
  getAvailableSlots,
  markSlotBooked,
  markSlotAvailable,
  insertSlot,
  createBooking,
  getActiveBooking,
  cancelBooking,
  getBookingsForDay,
  getUpcomingBookingsNeedingReminder,
  markReminderSent,
  getSessionFromDb,
  upsertSession,
  getActiveSessions,
  cleanupSessions,
  getSetting,
  setSetting,
};
