import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { db } from '../db.js';
import { config } from '../config.js';
import { COLUMNS, normalizeGame, insertMany, ValidationError } from '../games.js';
import { csvToObjects, objectsToCsv } from '../csv.js';

const router = express.Router();

const EXPORT_COLUMNS = ['id', ...COLUMNS, 'created_at', 'updated_at'];

/* --------------------------------------------------------------------------
 * Export
 * ----------------------------------------------------------------------- */

router.get('/export', (req, res) => {
  const rows = db.prepare('SELECT * FROM games ORDER BY id ASC').all();
  const stamp = new Date().toISOString().slice(0, 10);

  if (String(req.query.format).toLowerCase() === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gameshelf-${stamp}.csv"`);
    return res.send(objectsToCsv(rows, EXPORT_COLUMNS));
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
  developpeur: 'developer',
  studio: 'developer',
  editeur: 'publisher',
  annee: 'release_year',
  year: 'release_year',
  release: 'release_year',
  etat: 'condition',
  'état': 'condition',
  condition: 'condition',
  qte: 'quantity',
  quantite: 'quantity',
  'quantité': 'quantity',
  exemplaires: 'quantity',
  nombre: 'quantity',
  qty: 'quantity',
  note: 'rating',
  score: 'rating',
  achat: 'purchase_date',
  date_achat: 'purchase_date',
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

function mapRow(raw) {
  const row = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = String(key).trim().toLowerCase().replace(/\s+/g, '_');
    const target = HEADER_ALIASES[normalizedKey] || normalizedKey;
    if (row[target] === undefined || row[target] === '') row[target] = value;
  }

  if (row.condition) {
    const key = String(row.condition).trim().toLowerCase();
    row.condition = CONDITION_ALIASES[key] ?? key;
  }
  if (row.favorite !== undefined) row.favorite = truthy(row.favorite) ? 1 : 0;

  // Completude : une case vide dans un tableur signifie "present" (valeur par
  // defaut), on ne bascule a 0 que sur une valeur explicitement negative.
  for (const part of PART_KEYS) {
    if (row[part] === undefined || row[part] === '') continue;
    row[part] = falsy(row[part]) ? 0 : 1;
  }

  // Les tableurs francais utilisent souvent la virgule decimale.
  if (typeof row.rating === 'string') row.rating = row.rating.replace(',', '.');
  return row;
}

router.post('/import', (req, res) => {
  const { content, format = 'json', mode = 'merge' } = req.body || {};
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

  const errors = [];
  const prepared = [];
  rawRows.forEach((raw, index) => {
    try {
      prepared.push(normalizeGame(mapRow(raw)));
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
