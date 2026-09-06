import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { config } from './config.js';

const COOKIE_NAME = 'gs_session';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Compte administrateur cree au premier demarrage. */
export function ensureAdminUser() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (existing.n > 0) return null;

  const username = config.adminUsername || 'admin';
  const generated = !config.adminPassword;
  const password = config.adminPassword || crypto.randomBytes(12).toString('base64url');

  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    username,
    bcrypt.hashSync(password, 12),
  );

  return { username, password, generated };
}

export function verifyUser(username, password) {
  const user = db
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(String(username || '').trim());
  if (!user) {
    // Hash factice : garde un temps de reponse constant, qu'on connaisse ou
    // non l'utilisateur, pour ne pas divulguer l'existence d'un compte.
    bcrypt.compareSync(String(password || ''), '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
    return null;
  }
  if (!bcrypt.compareSync(String(password || ''), user.password_hash)) return null;
  return { id: user.id, username: user.username };
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.sessionDays * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    hashToken(token),
    userId,
    expiresAt,
  );
  return { token, expiresAt };
}

export function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function destroyAllSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function getSessionUser(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.expires_at, u.id, u.username
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(hashToken(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  return { id: row.id, username: row.username };
}

export function setSessionCookie(req, res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    // On se cale sur le protocole reel de la requete (req.secure tient compte
    // de X-Forwarded-Proto quand TRUST_PROXY est actif). Marquer le cookie
    // Secure sur une instance servie en HTTP simple empecherait toute
    // connexion : le navigateur refuserait de le stocker.
    secure: req.secure === true,
    expires: new Date(expiresAt),
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Renseigne req.user quand une session valide est presente. */
export function attachUser(req, _res, next) {
  if (config.disableAuth) {
    req.user = { id: 0, username: 'local', anonymous: true };
    return next();
  }
  req.user = getSessionUser(req.cookies?.[COOKIE_NAME]) || null;
  req.sessionToken = req.cookies?.[COOKIE_NAME] || null;
  next();
}

/** Bloque l'acces aux routes d'API protegees. */
export function requireAuth(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'Authentification requise' });
}

export function changePassword(userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(userId);
  if (!user) return { ok: false, error: 'Utilisateur introuvable' };
  if (!bcrypt.compareSync(String(currentPassword || ''), user.password_hash)) {
    return { ok: false, error: 'Mot de passe actuel incorrect' };
  }
  if (String(newPassword || '').length < 8) {
    return { ok: false, error: 'Le nouveau mot de passe doit faire au moins 8 caracteres' };
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(String(newPassword), 12),
    userId,
  );
  destroyAllSessions(userId);
  return { ok: true };
}

export function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

/**
 * Limiteur de tentatives en memoire : 10 essais par fenetre de 15 min et par IP.
 * Suffisant pour une instance mono-processus auto-hebergee.
 */
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginRateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const entry = attempts.get(key);

  if (entry && now - entry.first > WINDOW_MS) attempts.delete(key);

  const current = attempts.get(key);
  if (current && current.count >= MAX_ATTEMPTS) {
    const retryIn = Math.ceil((WINDOW_MS - (now - current.first)) / 1000);
    res.setHeader('Retry-After', String(retryIn));
    return res.status(429).json({
      error: `Trop de tentatives. Reessayez dans ${Math.ceil(retryIn / 60)} minute(s).`,
    });
  }
  next();
}

export function noteFailedLogin(req) {
  const key = req.ip || 'unknown';
  const entry = attempts.get(key);
  if (entry) entry.count += 1;
  else attempts.set(key, { count: 1, first: Date.now() });
}

export function clearLoginAttempts(req) {
  attempts.delete(req.ip || 'unknown');
}

export { COOKIE_NAME };
