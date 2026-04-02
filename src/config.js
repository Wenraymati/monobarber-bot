'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');

// Cargar knowledge
const barberInfoPath = path.join(__dirname, '../knowledge/barberInfo.json');
const barberInfo = JSON.parse(fs.readFileSync(barberInfoPath, 'utf8'));

// Config override desde Railway volume (permite cambiar sin redeploy)
const overridePath = '/data/barberConfig.json';
if (fs.existsSync(overridePath)) {
  try {
    const overrides = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    // Solo sobreescribir claves seguras (no business.name puede cambiar, horarios sí)
    if (overrides.schedule) barberInfo.schedule = { ...barberInfo.schedule, ...overrides.schedule };
    if (overrides.messages) barberInfo.messages = { ...barberInfo.messages, ...overrides.messages };
    if (overrides.services) barberInfo.services = overrides.services;
    console.log('[config] Override aplicado desde', overridePath);
  } catch (e) {
    console.warn('[config] Override inválido, usando config base:', e.message);
  }
}

const config = {
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || './data/bookings.db',

  evolution: {
    url: process.env.EVOLUTION_API_URL || '',
    apiKey: process.env.EVOLUTION_API_KEY || '',
    instance: process.env.EVOLUTION_INSTANCE || 'monobarber',
    webhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET || '',
  },

  owner: {
    waNumber: process.env.OWNER_WA_NUMBER || '',
  },

  dashboard: {
    token: process.env.DASHBOARD_TOKEN || 'demo-token',
  },

  barber: barberInfo,
};

// Validaciones con warnings (no bloquear startup)
if (!config.evolution.url) console.warn('[config] EVOLUTION_API_URL no configurado');
if (!config.evolution.apiKey) console.warn('[config] EVOLUTION_API_KEY no configurado');
if (!config.owner.waNumber) console.warn('[config] OWNER_WA_NUMBER no configurado — notificaciones al dueño desactivadas');

module.exports = config;
