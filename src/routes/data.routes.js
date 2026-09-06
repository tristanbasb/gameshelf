import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { db } from '../db.js';
import { config } from '../config.js';
import { normalizeGame, insertMany, ValidationError } from '../games.js';
import { csvToObjects, objectsToCsv } from '../csv.js';

const router = express.Router();

/* --------------------------------------------------------------------------
 * Export
 * ----------------------------------------------------------------------- */

/** Libelles d'etat, dans le vocabulaire utilise pour decrire une collection. */
const CONDITION_FR = {
  sealed: 'Neuf',
  mint: 'Très bon',
  good: 'Bon',
  fair: 'Acceptable',
  poor: 'Mauvais',
  '': '',
};

/** Elements suivis, avec le nom employe dans la colonne « Complet ». */
const PART_FR = [
  ['has_disc', 'CD'],
  ['has_box', 'Boîte'],
  ['has_cover_art', 'Jaquette'],
  ['has_manual', 'Notice'],
];

/**
 * Colonne « Complet » : « Oui » si rien ne manque, sinon la liste de ce qui
 * est present — la meme convention que les inventaires tenus a la main.
 */
function completenessLabel(row) {
  const present = PART_FR.filter(([key]) => row[key]);
  if (present.length === PART_FR.length) return 'Oui';
  if (present.length === 0) return 'Non';
  // La jaquette n'est citee que si elle se distingue de la boite : sinon elle
  // n'apporte rien et alourdirait un inventaire qui ne la suit pas.
  return present
    .filter(([key]) => key !== 'has_cover_art' || row.has_cover_art !== row.has_box)
    .map(([, label]) => label)
    .join(', ');
}

/** En-tetes du CSV, lisibles et re-importables tels quels. */
const CSV_COLUMNS = [
  ['Titre', (r) => r.title],
  ['Plateforme', (r) => r.platform],
  ['Région', (r) => r.region],
  ['État', (r) => CONDITION_FR[r.condition] ?? r.condition],
  ['Serial', (r) => r.serial],
  ['EAN', (r) => r.ean],
  ['Quantité', (r) => r.quantity],
  ['Complet', completenessLabel],
  ['ISO', (r) => (r.has_iso ? 'Oui' : 'Non')],
  ['Favori', (r) => (r.favorite ? 'Oui' : 'Non')],
  ['Tags', (r) => r.tags],
  ['Notes', (r) => r.notes],
  ['Visuel', (r) => r.cover_url],
  ['Ajouté le', (r) => r.created_at],
];

router.get('/export', (req, res) => {
  const rows = db.prepare('SELECT * FROM games ORDER BY title COLLATE NOCASE ASC').all();
  const stamp = new Date().toISOString().slice(0, 10);

  if (String(req.query.format).toLowerCase() === 'csv') {
    const headers = CSV_COLUMNS.map(([label]) => label);
    const shaped = rows.map((row) =>
      Object.fromEntries(CSV_COLUMNS.map(([label, read]) => [label, read(row)])));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="collection-${stamp}.csv"`);
    return res.send(objectsToCsv(shaped, headers));
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="gameshelf-${stamp}.json"`);
  res.send(
    JSON.stringify(
      { app: 'gameshelf', version: 1, exported_at: new Date().toISOString(), games: rows },
      null,
      2,
    ),
  );
});

/** Copie coherente de la base SQLite (utilise l'API backup, sans arret du service). */
router.get('/backup', async (_req, res, next) => {
  const tmpFile = path.join(config.dataDir, `backup-${Date.now()}.db`);
  try {
    await db.backup(tmpFile);
    res.download(tmpFile, `gameshelf-${new Date().toISOString().slice(0, 10)}.db`, (err) => {
      fs.rm(tmpFile, { force: true }, () => {});
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    fs.rm(tmpFile, { force: true }, () => {});
    next(err);
  }
});

/* --------------------------------------------------------------------------
 * Import
 * ----------------------------------------------------------------------- */

/** Accepte les en-tetes francais courants en plus des noms de colonnes. */
const HEADER_ALIASES = {
  titre: 'title',
  nom: 'title',
  name: 'title',
  plateforme: 'platform',
  console: 'platform',
  support: 'platform',
  etat: 'condition',
  'état': 'condition',
  condition: 'condition',
  region: 'region',
  'région': 'region',
  zone: 'region',
  serial: 'serial',
  serie: 'serial',
  'série': 'serial',
  reference: 'serial',
  'référence': 'serial',
  ref: 'serial',
  code_produit: 'serial',
  iso: 'has_iso',
  dump: 'has_iso',
  sauvegarde: 'has_iso',
  backup: 'has_iso',
  complet: '__complete',
  'complète': '__complete',
  complete: '__complete',
  contenu: '__complete',
  completude: '__complete',
  'complétude': '__complete',
  qte: 'quantity',
  quantite: 'quantity',
  'quantité': 'quantity',
  exemplaires: 'quantity',
  nombre: 'quantity',
  qty: 'quantity',
  favori: 'favorite',
  cover: 'cover_url',
  image: 'cover_url',
  visuel: 'cover_url',
  notes: 'notes',
  commentaire: 'notes',
  remarques: 'notes',
  tags: 'tags',
  etiquettes: 'tags',

  // Code-barres
  ean: 'ean',
  ean13: 'ean',
  code_barre: 'ean',
  code_barres: 'ean',
  codebarre: 'ean',
  barcode: 'ean',
  upc: 'ean',
  gtin: 'ean',

  // Completude d'un exemplaire physique
  boite: 'has_box',
  'boîte': 'has_box',
  box: 'has_box',
  jaquette: 'has_cover_art',
  pochette: 'has_cover_art',
  notice: 'has_manual',
  manuel: 'has_manual',
  livret: 'has_manual',
  manual: 'has_manual',
  disque: 'has_disc',
  cd: 'has_disc',
  dvd: 'has_disc',
  cartouche: 'has_disc',
  disc: 'has_disc',
};

const PART_KEYS = ['has_box', 'has_cover_art', 'has_manual', 'has_disc'];

const CONDITION_ALIASES = {
  neuf: 'sealed',
  neuve: 'sealed',
  'sous blister': 'sealed',
  blister: 'sealed',
  scelle: 'sealed',
  'scellé': 'sealed',
  sealed: 'sealed',
  new: 'sealed',
  'comme neuf': 'mint',
  'tres bon': 'mint',
  'très bon': 'mint',
  'tres bon etat': 'mint',
  'très bon état': 'mint',
  tbe: 'mint',
  excellent: 'mint',
  mint: 'mint',
  bon: 'good',
  'bon etat': 'good',
  'bon état': 'good',
  be: 'good',
  good: 'good',
  correct: 'fair',
  moyen: 'fair',
  acceptable: 'fair',
  passable: 'fair',
  fair: 'fair',
  abime: 'poor',
  'abîmé': 'poor',
  mauvais: 'poor',
  use: 'poor',
  'usé': 'poor',
  poor: 'poor',
};

const truthy = (value) =>
  ['1', 'true', 'oui', 'yes', 'x', 'vrai'].includes(String(value ?? '').trim().toLowerCase());

/** Valeurs signalant une piece manquante dans un tableur. */
const falsy = (value) =>
  ['0', 'false', 'non', 'no', 'n', 'faux', 'manquant', 'manquante', 'absent', 'absente', 'sans']
    .includes(String(value ?? '').trim().toLowerCase());

/** Mots designant chaque element dans une colonne « Complet » enumeree. */
const PART_WORDS = {
  has_disc: ['cd', 'dvd', 'disque', 'disc', 'jeu', 'cartouche', 'galette'],
  has_box: ['boite', 'boîte', 'box', 'etui', 'étui', 'case'],
  has_cover_art: ['jaquette', 'pochette', 'cover', 'inlay'],
  has_manual: ['notice', 'manuel', 'livret', 'manual'],
};

const splitParts = (raw) => raw.split(/[,;/+&]| et /).map((w) => w.trim()).filter(Boolean);

/**
 * Elements qu'une colonne « Complet » enumeree permet de declarer manquants.
 *
 * Le support, la boite et la notice forment le vocabulaire commun des
 * inventaires : ne pas les citer signifie qu'ils manquent. La jaquette, elle,
 * n'est presque jamais distinguee de la boite ; en conclure qu'elle manque
 * partout fausserait la collection. Elle n'entre donc dans le calcul que si
 * le fichier la nomme au moins une fois.
 */
const CORE_PARTS = ['has_disc', 'has_box', 'has_manual'];

export function trackedParts(values) {
  const tracked = new Set(CORE_PARTS);
  for (const value of values) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw || truthy(raw) || falsy(raw)) continue;
    for (const word of splitParts(raw)) {
      if (PART_WORDS.has_cover_art.includes(word)) tracked.add('has_cover_art');
    }
  }
  return tracked;
}

/**
 * Interprete la colonne « Complet ».
 *   « Oui »             -> tout est present
 *   « CD, Boîte »       -> parmi les elements suivis, seuls les cites sont la
 *   « Non »             -> on ne sait pas ce qui manque : on ne garde que le
 *                          support, seule certitude quand le jeu est possede
 */
function applyCompleteness(row, value, tracked) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return;

  if (truthy(raw) || raw === 'complet' || raw === 'complète' || raw === 'complet(e)') {
    for (const part of PART_KEYS) row[part] = 1;
    return;
  }

  if (falsy(raw)) {
    for (const part of PART_KEYS) row[part] = tracked.has(part) ? 0 : 1;
    row.has_disc = 1;
    return;
  }

  const words = splitParts(raw);
  for (const part of PART_KEYS) {
    if (!tracked.has(part)) continue;
    row[part] = words.some((word) => (PART_WORDS[part] || []).includes(word)) ? 1 : 0;
  }
}

/** Un tiret seul est la facon courante de noter une case vide. */
const blankIfDash = (value) => {
  const s = String(value ?? '').trim();
  return s === '-' || s === '—' || s === 'n/a' ? '' : value;
};

function mapRow(raw, { defaultPlatform = '', tracked = new Set(PART_KEYS) } = {}) {
  const row = {};
  // Colonnes decrivant un seul element (« Notice », « Boîte »...) : gardees a
  // part, car elles doivent primer sur la colonne « Complet » globale.
  const explicitParts = {};

  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = String(key).trim().toLowerCase().replace(/\s+/g, '_');
    const target = HEADER_ALIASES[normalizedKey] || normalizedKey;
    const clean = blankIfDash(value);

    if (PART_KEYS.includes(target)) {
      if (explicitParts[target] === undefined) explicitParts[target] = clean;
      continue;
    }
    if (row[target] === undefined || row[target] === '') row[target] = clean;
  }

  if (row.condition) {
    const key = String(row.condition).trim().toLowerCase();
    row.condition = CONDITION_ALIASES[key] ?? key;
  }
  if (row.favorite !== undefined) row.favorite = truthy(row.favorite) ? 1 : 0;
  if (row.has_iso !== undefined) row.has_iso = truthy(row.has_iso) ? 1 : 0;

  // 1. La colonne « Complet » decrit l'ensemble du contenu.
  if (row.__complete !== undefined) {
    applyCompleteness(row, row.__complete, tracked);
    delete row.__complete;
  }

  // 2. Une colonne dediee a un element precise ou corrige ce constat. Une
  //    case vide vaut « present » : on ne descend a 0 que sur un « non ».
  for (const [part, value] of Object.entries(explicitParts)) {
    if (value === undefined || String(value).trim() === '') continue;
    row[part] = falsy(value) ? 0 : 1;
  }

  // Un export par plateforme n'a pas de colonne plateforme : on la complete.
  if (!row.platform && defaultPlatform) row.platform = defaultPlatform;

  return row;
}

router.post('/import', (req, res) => {
  const { content, format = 'json', mode = 'merge', defaultPlatform = '' } = req.body || {};
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Aucun contenu a importer' });
  }

  let rawRows;
  if (String(format).toLowerCase() === 'csv') {
    rawRows = csvToObjects(content);
  } else {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return res.status(400).json({ error: 'JSON invalide' });
    }
    rawRows = Array.isArray(parsed) ? parsed : parsed?.games;
    if (!Array.isArray(rawRows)) {
      return res.status(400).json({ error: 'JSON attendu : un tableau, ou un objet { games: [...] }' });
    }
  }

  if (rawRows.length === 0) return res.status(400).json({ error: 'Aucune ligne exploitable' });
  if (rawRows.length > 20000) return res.status(413).json({ error: 'Import limite a 20000 lignes' });

  // Le vocabulaire de completude se deduit du fichier entier, pas ligne a ligne.
  const completeKeys = ['complet', 'complète', 'complete', 'contenu', 'completude', 'complétude'];
  const tracked = trackedParts(
    rawRows.flatMap((raw) =>
      Object.entries(raw)
        .filter(([key]) => completeKeys.includes(String(key).trim().toLowerCase()))
        .map(([, value]) => value)),
  );

  const errors = [];
  const prepared = [];
  const options = { defaultPlatform: String(defaultPlatform).trim(), tracked };
  rawRows.forEach((raw, index) => {
    try {
      prepared.push(normalizeGame(mapRow(raw, options)));
    } catch (err) {
      if (err instanceof ValidationError) errors.push(`Ligne ${index + 2} : ${err.message}`);
      else throw err;
    }
  });

  if (prepared.length === 0) {
    return res.status(400).json({ error: 'Aucune ligne valide', details: errors.slice(0, 20) });
  }

  let skipped = 0;
  let imported = 0;

  const run = db.transaction(() => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM games').run();
      imported = insertMany(prepared);
      return;
    }
    // Mode fusion : on ignore les doublons titre + plateforme deja presents.
    const exists = db.prepare(
      'SELECT 1 FROM games WHERE title = ? COLLATE NOCASE AND platform = ? COLLATE NOCASE',
    );
    const toInsert = [];
    for (const row of prepared) {
      if (exists.get(row.title, row.platform)) skipped += 1;
      else toInsert.push(row);
    }
    imported = toInsert.length ? insertMany(toInsert) : 0;
  });
  run();

  res.json({
    ok: true,
    imported,
    skipped,
    invalid: errors.length,
    details: errors.slice(0, 20),
  });
});

/* --------------------------------------------------------------------------
 * Upload de jaquettes
 * ----------------------------------------------------------------------- */

const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadsDir),
    filename: (_req, file, cb) => {
      const ext = ALLOWED_IMAGE_TYPES[file.mimetype] || '.bin';
      cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES[file.mimetype]) return cb(null, true);
    cb(new ValidationError('Format d image non supporte (JPEG, PNG, WebP, GIF ou AVIF)'));
  },
});

router.post('/upload', upload.single('cover'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier recu' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

export default router;
