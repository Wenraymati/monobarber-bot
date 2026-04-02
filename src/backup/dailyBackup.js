'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Copia el archivo SQLite a /data/bookings.backup.db
 * Se llama una vez por día desde server.js a las 6am Santiago.
 * Fire-and-forget — no lanza excepciones al proceso principal.
 */
async function runDailyBackup() {
  try {
    const src = config.dbPath;
    const resolvedSrc = path.resolve(src);

    if (!fs.existsSync(resolvedSrc)) {
      console.warn('[backup] DB no encontrada en', resolvedSrc);
      return;
    }

    // Backup al mismo directorio con sufijo .backup.db
    const dir = path.dirname(resolvedSrc);
    const dest = path.join(dir, 'bookings.backup.db');

    fs.copyFileSync(resolvedSrc, dest);

    const sizeMB = (fs.statSync(dest).size / 1024 / 1024).toFixed(2);
    console.log(`[backup] DB copiada a ${dest} (${sizeMB} MB)`);
  } catch (err) {
    console.error('[backup] Error en backup diario:', err.message);
    // No relanzar — no queremos crashear el servidor por un backup fallido
  }
}

module.exports = { runDailyBackup };
