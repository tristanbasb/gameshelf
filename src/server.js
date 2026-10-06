import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { config, localAddresses } from './config.js';
import { db, fusionnerJournal } from './db.js';
import { loadOrCreateCertificate, CERT_FILE } from './tls.js';
import { ValidationError } from './games.js';
import { limite } from './limite.js';
import { demarrerEntretien } from './uploads.js';
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

/* --------------------------------------------------------------------------
 * Requetes venues d'un autre site
 *
 * L'application n'a pas d'authentification : toute personne sur le reseau
 * local peut lire et modifier la collection, et c'est le compromis assume
 * d'une installation domestique. Mais sans precaution ce compromis va plus
 * loin qu'il n'y parait : n'importe quelle page web ouverte dans le
 * navigateur de la maison peut poster vers l'API. Le navigateur envoie une
 * requete simple — un formulaire suffit — sans jamais demander au serveur
 * s'il l'accepte, et un seul appel a /api/import remplacerait la collection.
 * « Ne pas exposer le port sur Internet » n'y change rien : c'est le
 * navigateur lui-meme qui sert de pont.
 *
 * Sec-Fetch-Site est pose par le navigateur et aucun script de page ne peut
 * le modifier. Quand il manque — navigateur ancien, curl, script — on retombe
 * sur Origin, qui n'est pas falsifiable depuis une page non plus. Une requete
 * sans l'un ni l'autre (curl, sonde de sante) reste acceptee : la protection
 * vise le navigateur, seul a pouvoir etre manoeuvre a distance.
 * ----------------------------------------------------------------------- */

const METHODES_SURES = new Set(['GET', 'HEAD', 'OPTIONS']);

app.use((req, res, next) => {
  if (METHODES_SURES.has(req.method)) return next();

  const provenance = req.get('Sec-Fetch-Site');
  const origine = req.get('Origin');
  const refus = () =>
    res.status(403).json({
      error: 'Requete refusee : elle ne vient pas de l application',
    });

  if (provenance) {
    // « none » : une adresse tapee a la main ou un favori, sans page a
    // l'origine. « same-origin » : l'application elle-meme.
    if (provenance !== 'same-origin' && provenance !== 'none') return refus();
  } else if (origine && origine !== `${req.protocol}://${req.get('Host')}`) {
    return refus();
  }

  next();
});

/*
 * Seul le JSON est accepte comme corps de requete. Les formulaires encodes et
 * le texte brut sont les deux seuls types qu'un navigateur envoie a un autre
 * site sans autorisation prealable : ne pas les lire du tout ferme la porte
 * une seconde fois. L'interface n'envoie que du JSON, ou un fichier.
 */
app.use(express.json({ limit: '25mb' }));

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
  'css/fonts.css',
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

/*
 * Ces URL sont uniques par version : elles peuvent etre gardees
 * indefiniment. L'empreinte est verifiee avant de promettre un an de cache —
 * sans quoi n'importe quel prefixe invente obtiendrait la meme promesse, et
 * figerait dans un navigateur un fichier sous une adresse qui ne changera
 * jamais.
 */
const EMPREINTE_VALIDE = /^[0-9a-f]{10}$/;

const fichiersVersionnes = express.static(publicDir, {
  index: false,
  immutable: true,
  maxAge: '1y',
  dotfiles: 'ignore',
});

app.use('/a/:version', (req, res, next) => {
  if (!EMPREINTE_VALIDE.test(req.params.version)) return next();
  fichiersVersionnes(req, res, next);
});

app.get(['/', '/index.html'], (_req, res, next) => {
  fs.readFile(path.join(publicDir, 'index.html'), 'utf8', (err, html) => {
    if (err) return next(err);
    const version = assetVersion();
    // La page elle-meme n'est jamais mise en cache : c'est elle qui porte
    // l'empreinte, elle doit donc toujours etre relue.
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(
      html
        .replaceAll('/css/fonts.css', `/a/${version}/css/fonts.css`)
        .replaceAll('/css/style.css', `/a/${version}/css/style.css`)
        .replaceAll('/js/app.js', `/a/${version}/js/app.js`),
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

/*
 * Garde-fous. Les plafonds sont choisis bien au-dessus d'un usage reel : la
 * consultation d'une page fait une dizaine d'appels, un scan deux ou trois,
 * et une collection se tient a la main, pas a la seconde.
 */
app.use('/api', limite({ nom: 'api', max: 600, secondes: 60 }));

const limiteEcritures = limite({
  nom: 'ecritures',
  max: 120,
  secondes: 60,
  message: 'Trop de modifications d un coup, patientez un instant',
});

app.use('/api', (req, res, next) => {
  if (METHODES_SURES.has(req.method)) return next();
  // Le journal rejoint la base des que la reponse est partie : gameshelf.db
  // reste a tout instant la collection complete.
  res.once('finish', fusionnerJournal);
  return limiteEcritures(req, res, next);
});

// Operations lourdes ou destructrices : chacune son compteur.
app.use('/api/upload', limite({
  nom: 'upload',
  max: 60,
  secondes: 600,
  message: 'Trop d images televersees d affilee, patientez quelques minutes',
}));
// Un import se reprend souvent plusieurs fois de suite, le temps de corriger
// le fichier : le plafond doit laisser la place a ces essais.
app.use('/api/import', limite({
  nom: 'import',
  max: 20,
  secondes: 600,
  message: 'Trop d imports d affilee, patientez quelques minutes',
}));
app.use('/api/backup', limite({
  nom: 'backup',
  max: 10,
  secondes: 600,
  message: 'Trop de sauvegardes d affilee, patientez quelques minutes',
}));

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
// Express identifie le gestionnaire d'erreur a ses quatre arguments : le
// dernier doit rester declare, meme inutilise.
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
  // Un code hors de la plage des erreurs HTTP ferait echouer la reponse
  // elle-meme : on ne retient que ceux qui en sont.
  const codeFourni = Number(err?.status);
  const code = Number.isInteger(codeFourni) && codeFourni >= 400 && codeFourni <= 599
    ? codeFourni
    : 500;
  res.status(code).json({
    error: code === 500 ? 'Erreur interne du serveur' : err.message || 'Requete refusee',
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

  // Jaquettes orphelines : au demarrage, puis une fois par heure.
  demarrerEntretien();

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
      // Le fichier principal doit porter la collection complete, meme si
      // personne ne redemarre le service avant la prochaine sauvegarde.
      fusionnerJournal();
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
