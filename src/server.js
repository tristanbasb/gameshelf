import express from 'express';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { config, localAddresses } from './config.js';
import { db } from './db.js';
import { loadOrCreateCertificate } from './tls.js';
import { ValidationError } from './games.js';
import gamesRoutes from './routes/games.routes.js';
import dataRoutes from './routes/data.routes.js';
import externalRoutes from './routes/external.routes.js';

const publicDir = path.join(config.root, 'public');
const app = express();

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

app.get(['/', '/index.html'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDir, 'index.html'));
});

/*
 * Les fichiers de l'interface ne sont pas versionnes : un cache ferme
 * laisserait tourner l'ancienne version apres une mise a jour. On demande
 * donc une revalidation systematique — l'ETag renvoie un 304 quasi gratuit,
 * et sur un reseau local le cout est negligeable.
 */
app.use(
  express.static(publicDir, {
    index: false,
    maxAge: 0,
    etag: true,
    lastModified: true,
    dotfiles: 'ignore',
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }),
);

/* --------------------------------------------------------------------------
 * API
 * ----------------------------------------------------------------------- */

/** Capacites de l'instance, lues au demarrage de l'interface. */
app.get('/api/config', (req, res) => {
  res.json({
    externalSearch: Boolean(config.rawgApiKey),
    // L'interface previent l'utilisateur quand la camera sera refusee.
    secure: req.secure || req.hostname === 'localhost',
  });
});

app.use('/api', gamesRoutes);
app.use('/api', dataRoutes);
app.use('/api', externalRoutes);

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
console.log('');
console.log('  GameShelf - inventaire de collection de jeux video');

const credentials = loadOrCreateCertificate();
const scheme = credentials ? 'https' : 'http';
const server = credentials
  ? https.createServer(credentials, app)
  : http.createServer(app);

server.listen(config.port, config.host, () => {
  const addresses = localAddresses();
  console.log('');
  console.log(`  Sur cette machine : ${scheme}://localhost:${config.port}`);
  if (addresses.length) {
    console.log('  Depuis le telephone (meme reseau Wi-Fi) :');
    for (const address of addresses) {
      console.log(`     ${scheme}://${address}:${config.port}`);
    }
  }
  console.log('');
  console.log(`  Donnees : ${config.dataDir}`);

  if (credentials) {
    console.log('');
    console.log('  Le certificat est auto-signe : le navigateur affichera un');
    console.log('  avertissement a la premiere visite. Acceptez-le une fois,');
    console.log('  c est ce qui autorise la camera pour le scan.');
  } else {
    console.log('');
    console.log('  ! Mode HTTP : le scan par camera sera refuse par le');
    console.log('    navigateur du telephone (saisie manuelle uniquement).');
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
