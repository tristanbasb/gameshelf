import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { config, localAddresses } from './config.js';
import { db } from './db.js';
import { loadOrCreateCertificate, CERT_FILE } from './tls.js';
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

// L'icone est declaree en SVG dans la page, mais les navigateurs sondent
// malgre tout /favicon.ico. Une reponse vide evite un 404 a chaque visite,
// dans la console comme dans les journaux du serveur.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

/*
 * Certificat local, telechargeable depuis le telephone.
 *
 * Safari sur iPhone reste souvent reticent a ouvrir la camera sur un
 * certificat auto-signe seulement « accepte ». L'installer comme certificat
 * de confiance leve l'obstacle, et le recuperer depuis l'appareil lui-meme
 * est de loin le chemin le plus court. Seule la partie publique est servie,
 * jamais la cle privee.
 */
app.get('/cert.pem', (_req, res) => {
  fs.readFile(CERT_FILE, 'utf8', (err, pem) => {
    if (err) {
      return res.status(404).json({ error: 'Aucun certificat local (ENABLE_HTTPS=0 ?)' });
    }
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="gamevault.pem"');
    res.send(pem);
  });
});

/* --------------------------------------------------------------------------
 * Invalidation du cache
 *
 * L'interface n'a pas d'etape de build : sans precaution, un navigateur garde
 * l'ancien CSS ou l'ancien script apres une mise a jour, parfois une heure,
 * parfois jusqu'a un rechargement force. Les fichiers sont donc aussi servis
 * sous /a/<empreinte>/, empreinte qui change des qu'un fichier change.
 *
 * Le prefixe fait partie du chemin, pas d'un parametre : les imports relatifs
 * entre modules (`./api.js`) se resolvent alors d'eux-memes dans le meme
 * dossier versionne, sans avoir a reecrire le code servi.
 * ----------------------------------------------------------------------- */

const VERSIONED_ASSETS = [
  'css/style.css',
  'js/app.js',
  'js/api.js',
  'js/ui.js',
  'js/barcode.js',
  'js/scan-worker.js',
  'js/vendor/zxing.min.js',
];

function assetVersion() {
  const hash = crypto.createHash('sha1');
  for (const relative of VERSIONED_ASSETS) {
    try {
      const { mtimeMs, size } = fs.statSync(path.join(publicDir, relative));
      hash.update(`${relative}:${mtimeMs}:${size};`);
    } catch {
      // Fichier absent : l'empreinte change, ce qui est le comportement voulu.
      hash.update(`${relative}:absent;`);
    }
  }
  return hash.digest('hex').slice(0, 10);
}

// Ces URL sont uniques par version : elles peuvent etre gardees indefiniment.
app.use(
  '/a/:version',
  express.static(publicDir, {
    index: false,
    immutable: true,
    maxAge: '1y',
    dotfiles: 'ignore',
  }),
);

app.get(['/', '/index.html'], (_req, res, next) => {
  fs.readFile(path.join(publicDir, 'index.html'), 'utf8', (err, html) => {
    if (err) return next(err);
    const version = assetVersion();
    // La page elle-meme n'est jamais mise en cache : c'est elle qui porte
    // l'empreinte, elle doit donc toujours etre relue.
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(
      html
        .replace('/css/style.css', `/a/${version}/css/style.css`)
        .replace('/js/app.js', `/a/${version}/js/app.js`),
    );
  });
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

const appVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')).version;
  } catch {
    return '';
  }
})();

/** Capacites de l'instance, lues au demarrage de l'interface. */
app.get('/api/config', (req, res) => {
  res.json({
    version: appVersion,
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
console.log('  GameVault - inventaire de collection de jeux video');

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
