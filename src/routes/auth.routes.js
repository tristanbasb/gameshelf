import express from 'express';
import { config } from '../config.js';
import {
  verifyUser,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  changePassword,
  requireAuth,
  loginRateLimit,
  noteFailedLogin,
  clearLoginAttempts,
} from '../auth.js';

const router = express.Router();

router.get('/me', (req, res) => {
  res.json({
    authenticated: Boolean(req.user),
    user: req.user ? { username: req.user.username } : null,
    authDisabled: config.disableAuth,
    externalSearch: Boolean(config.rawgApiKey),
  });
});

router.post('/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  const user = verifyUser(username, password);

  if (!user) {
    noteFailedLogin(req);
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  clearLoginAttempts(req);
  const { token, expiresAt } = createSession(user.id);
  setSessionCookie(req, res, token, expiresAt);
  res.json({ ok: true, user: { username: user.username } });
});

router.post('/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.post('/password', requireAuth, (req, res) => {
  if (config.disableAuth) {
    return res.status(400).json({ error: "L'authentification est desactivee sur cette instance" });
  }
  const { currentPassword, newPassword } = req.body || {};
  const result = changePassword(req.user.id, currentPassword, newPassword);
  if (!result.ok) return res.status(400).json({ error: result.error });

  // Toutes les sessions ont ete revoquees : on deconnecte aussi le navigateur courant.
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
