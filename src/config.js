import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Mini-chargeur .env (evite une dependance a dotenv).
 * Les variables deja presentes dans process.env ne sont jamais ecrasees :
 * l'environnement reel (systemd, docker-compose) reste prioritaire.
 */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const dataDir = path.resolve(ROOT, process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

/** Adresses IPv4 locales, utilisees pour le certificat et les URL affichees. */
export function localAddresses() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) found.push(iface.address);
    }
  }
  return found;
}

export const config = {
  root: ROOT,
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  dbFile: path.join(dataDir, 'gameshelf.db'),

  // HTTPS auto-signe : indispensable pour que la camera du telephone
  // fonctionne sur un reseau local, sans nom de domaine ni certificat public.
  https: bool(process.env.ENABLE_HTTPS, true),
  tlsDir: path.join(dataDir, 'tls'),

  rawgApiKey: (process.env.RAWG_API_KEY || '').trim(),
  maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 5) * 1024 * 1024,
  nodeEnv: process.env.NODE_ENV || 'production',
};
