import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

let sessionSecret = process.env.SESSION_SECRET;
let generatedSecret = false;
if (!sessionSecret) {
  // Pas de secret fourni : on en persiste un dans le dossier de donnees pour
  // que les sessions survivent a un redemarrage.
  const secretFile = path.join(dataDir, '.session-secret');
  if (fs.existsSync(secretFile)) {
    sessionSecret = fs.readFileSync(secretFile, 'utf8').trim();
  } else {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, sessionSecret, { mode: 0o600 });
    generatedSecret = true;
  }
}

export const config = {
  root: ROOT,
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  dbFile: path.join(dataDir, 'gameshelf.db'),
  adminUsername: (process.env.ADMIN_USERNAME || 'admin').trim(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret,
  generatedSecret,
  sessionDays: int(process.env.SESSION_DAYS, 30),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  disableAuth: bool(process.env.DISABLE_AUTH, false),
  rawgApiKey: (process.env.RAWG_API_KEY || '').trim(),
  maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 5) * 1024 * 1024,
  nodeEnv: process.env.NODE_ENV || 'production',
};
