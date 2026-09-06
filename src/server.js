import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import {
  attachUser,
  requireAuth,
  ensureAdminUser,
  purgeExpiredSessions,
} from './auth.js';
import { ValidationError } from './games.js';
import authRoutes from './routes/auth.routes.js';
import gamesRoutes from './routes/games.routes.js';
import dataRoutes from './routes/data.routes.js';
import externalRoutes from './routes/external.routes.js';

const publicDir = path.join(config.root, 'public');
const app = express();

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

/* --------------------------------------------------------------------------
 * En-tetes de securite
 * ----------------------------------------------------------------------- */
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      // Les visuels peuvent venir de n'importe quel hebergeur d'images.
      'img-src * data: blob:',
      // Flux de la camera pour le scan de codes-barres.
      "media-src 'self' blob:",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
});

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);

/* --------------------------------------------------------------------------
 * Fichiers statiques
 * ----------------------------------------------------------------------- */
app.use(
  '/uploads',
  express.static(config.uploadsDir, {
    maxAge: '30d',
    immutable: true,
    index: false,
    dotfiles: 'ignore',
  }),
);

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

// Page de connexion : accessible sans session.
app.get(['/login', '/login.html'], (req, res) => {
  if (req.user) return res.redirect('/');
  res.sendFile(path.join(publicDir, 'login.html'));
});

// Application : necessite une session valide.
app.get(['/', '/index.html'], (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(express.static(publicDir, { index: false, maxAge: '1h', dotfiles: 'ignore' }));

/* --------------------------------------------------------------------------
 * API
 * ----------------------------------------------------------------------- */
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, gamesRoutes);
app.use('/api', requireAuth, dataRoutes);
app.use('/api', requireAuth, externalRoutes);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Route inconnue' });
});

app.use((_req, res) => {
  res.status(404).sendFile(path.join(publicDir, '404.html'));
});

/* --------------------------------------------------------------------------
 * Gestion des erreurs
 * ----------------------------------------------------------------------- */
// eslint-disable-next-line no-unused-vars -- Express identifie le handler d'erreur a ses 4 arguments
app.use((err, _req, res, _next) => {
  if (err instanceof ValidationError || err?.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `Fichier trop volumineux (max ${Math.round(config.maxUploadBytes / 1024 / 1024)} Mo)`,
    });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Requete trop volumineuse' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corps de requete JSON invalide' });
  }

  console.error('[erreur]', err);
  res.status(err?.status && err.status < 600 ? err.status : 500).json({
    error: err?.status ? err.message : 'Erreur interne du serveur',
  });
});

/* --------------------------------------------------------------------------
 * Demarrage
 * ----------------------------------------------------------------------- */
const created = ensureAdminUser();
purgeExpiredSessions();
const purgeTimer = setInterval(purgeExpiredSessions, 6 * 60 * 60 * 1000);
purgeTimer.unref();

const server = app.listen(config.port, config.host, () => {
  console.log('');
  console.log('  GameShelf - gestionnaire de collection de jeux video');
  console.log(`  Ecoute sur http://${config.host}:${config.port}`);
  console.log(`  Donnees   : ${config.dataDir}`);
  console.log(`  Auth      : ${config.disableAuth ? 'DESACTIVEE' : 'activee'}`);
  console.log(`  RAWG      : ${config.rawgApiKey ? 'configuree' : 'non configuree'}`);

  if (created) {
    console.log('');
    console.log('  ------------------------------------------------------------');
    console.log('   Compte administrateur cree');
    console.log(`   Identifiant : ${created.username}`);
    if (created.generated) {
      console.log(`   Mot de passe : ${created.password}`);
      console.log('   (genere automatiquement - notez-le, il ne sera plus affiche)');
    } else {
      console.log('   Mot de passe : celui defini dans ADMIN_PASSWORD');
    }
    console.log('  ------------------------------------------------------------');
  }
  if (config.generatedSecret) {
    console.log('  Note : SESSION_SECRET absent du .env, un secret a ete genere');
    console.log(`         et stocke dans ${config.dataDir}/.session-secret`);
  }
  console.log('');
});

function shutdown(signal) {
  console.log(`\n${signal} recu, arret en cours...`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* deja fermee */
    }
    process.exit(0);
  });
  // Filet de securite si des connexions restent ouvertes.
  setTimeout(() => process.exit(0), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
