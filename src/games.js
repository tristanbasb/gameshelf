import { db, CONDITIONS, PARTS, normalizeForSearch, buildSearchText } from './db.js';

const MAX_TEXT = 120;
const MAX_NOTES = 8000;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

const str = (value, max = MAX_TEXT) => String(value ?? '').trim().slice(0, max);

/** Coche / case a cocher : accepte booleens, entiers et chaines de formulaire. */
const flag = (value, fallback = 1) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1' || value === 'on' || value === 'true') return 1;
  return 0;
};

function optionalNumber(value, { min, max, integer = false, label }) {
  if (value === undefined || value === null || value === '') return null;
  const n = integer ? Number.parseInt(value, 10) : Number.parseFloat(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${label} : valeur numerique invalide`);
  if (min !== undefined && n < min) throw new ValidationError(`${label} : doit etre >= ${min}`);
  if (max !== undefined && n > max) throw new ValidationError(`${label} : doit etre <= ${max}`);
  return n;
}

/**
 * Code-barres : on ne garde que les chiffres (les scanners et les copier-coller
 * ajoutent souvent espaces et tirets). Longueurs usuelles : UPC-A 12,
 * EAN-13 13, EAN-8 8, ITF-14 14.
 */
export function normalizeEan(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^\d{8,14}$/.test(digits)) {
    throw new ValidationError('Code-barres : 8 a 14 chiffres attendus');
  }
  return digits;
}

export function normalizeTags(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const tag = String(raw).trim().slice(0, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, 20).join(', ');
}

/** Nettoie une URL d'image : http(s) externe, ou chemin /uploads/ local. */
function normalizeCoverUrl(value) {
  const raw = String(value ?? '').trim().slice(0, 1000);
  if (!raw) return '';
  if (raw.startsWith('/uploads/')) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    /* url invalide */
  }
  throw new ValidationError('Image : URL invalide (http:// ou https:// attendu)');
}

/** Transforme une charge utile brute en ligne prete pour la base. */
export function normalizeGame(input = {}) {
  const title = str(input.title, 200);
  if (!title) throw new ValidationError('Le titre est obligatoire');

  // L'etat peut rester vide : tout le monde ne le renseigne pas.
  const condition = str(input.condition, 20).toLowerCase();
  if (condition && !CONDITIONS.includes(condition)) {
    throw new ValidationError(`Etat invalide (valeurs possibles : ${CONDITIONS.join(', ')})`);
  }

  const quantity = optionalNumber(input.quantity, {
    min: 1, max: 9999, integer: true, label: 'Quantite',
  });

  const row = {
    title,
    platform: str(input.platform),
    region: str(input.region, 20),
    serial: str(input.serial, 40),
    ean: normalizeEan(input.ean),
    quantity: quantity ?? 1,
    condition,
    has_iso: flag(input.has_iso, 0),
    favorite: flag(input.favorite, 0),
    cover_url: normalizeCoverUrl(input.cover_url),
    notes: str(input.notes, MAX_NOTES),
    tags: normalizeTags(input.tags),
  };

  // Ce que contient l'exemplaire : present par defaut.
  for (const part of PARTS) {
    row[part] = flag(input[part], 1);
  }

  // Recalculee a chaque ecriture, pour ne jamais diverger du reste de la ligne.
  row.search_text = buildSearchText(row);

  return row;
}

const COLUMNS = [
  'title', 'platform', 'region', 'serial', 'ean', 'quantity', 'condition',
  ...PARTS, 'has_iso', 'favorite', 'cover_url', 'notes', 'tags', 'search_text',
];

/*
 * Colonnes renvoyees aux clients. search_text en est exclue : elle duplique
 * les autres champs et gonflerait la liste d'environ 40 % pour rien.
 */
const SELECT_COLUMNS = ['id', ...COLUMNS.filter((c) => c !== 'search_text'), 'created_at', 'updated_at']
  .join(', ');

const SORTABLE = {
  title: 'title COLLATE NOCASE',
  platform: 'platform COLLATE NOCASE',
  region: 'region COLLATE NOCASE',
  serial: 'serial COLLATE NOCASE',
  quantity: 'quantity',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

/** Condition SQL : au moins un element manquant dans l'exemplaire. */
const INCOMPLETE_SQL = `(${PARTS.map((p) => `${p} = 0`).join(' OR ')})`;

export function listGames(query = {}) {
  const where = [];
  const params = {};

  if (query.search) {
    // Chaque mot doit apparaitre quelque part dans la fiche, dans n'importe
    // quel ordre : « jak daxter » trouve « Jak and Daxter ». La colonne
    // interrogee etant deja sans accents ni majuscules, « asterix » trouve
    // « Astérix ».
    const words = normalizeForSearch(query.search).split(/\s+/).filter(Boolean).slice(0, 8);
    words.forEach((word, index) => {
      where.push(`search_text LIKE @mot${index}`);
      params[`mot${index}`] = `%${word}%`;
    });
  }
  if (query.ean) {
    where.push('ean = @ean');
    params.ean = String(query.ean).replace(/[\s-]/g, '');
  }
  if (query.platform) {
    where.push('platform = @platform');
    params.platform = String(query.platform);
  }
  if (query.condition) {
    where.push('condition = @condition');
    params.condition = String(query.condition);
  }
  if (query.region) {
    where.push('region = @region');
    params.region = String(query.region);
  }
  if (query.serial) {
    where.push('serial = @serial');
    params.serial = String(query.serial);
  }
  if (query.iso === '0' || query.iso === '1') {
    where.push(`has_iso = ${query.iso === '1' ? 1 : 0}`);
  }
  if (query.favorite === '1' || query.favorite === true) {
    where.push('favorite = 1');
  }
  if (query.incomplete === '1' || query.incomplete === true) {
    where.push(INCOMPLETE_SQL);
  }
  if (query.tag) {
    where.push("(', ' || tags || ',') LIKE @tag");
    params.tag = `%, ${String(query.tag).trim()},%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sortKey = SORTABLE[query.sort] ? query.sort : 'created_at';
  const direction = String(query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // Les colonnes optionnelles (note, annee...) restent en fin de liste quand
  // elles sont vides, quel que soit le sens de tri.
  const orderSql = `ORDER BY (${SORTABLE[sortKey]}) IS NULL, ${SORTABLE[sortKey]} ${direction}, id DESC`;

  // limit=0 (ou "all") : on renvoie toute la collection, sans pagination.
  const rawLimit = String(query.limit ?? '').toLowerCase();
  const showAll = rawLimit === 'all' || rawLimit === '0';
  const limit = showAll ? -1 : Math.min(Math.max(Number.parseInt(query.limit, 10) || 60, 1), 1000);
  const page = showAll ? 1 : Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const offset = showAll ? 0 : (page - 1) * limit;

  // better-sqlite3 refuse un objet de parametres pour une requete qui n'en
  // attend aucun : sans filtre actif, on appelle get() sans argument.
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(quantity), 0) AS copies FROM games ${whereSql}`,
  );
  const counts = Object.keys(params).length ? countStmt.get(params) : countStmt.get();

  // LIMIT -1 signifie "aucune limite" en SQLite.
  const items = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM games ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  return {
    items,
    total: counts.n,
    copies: counts.copies,
    page,
    limit: showAll ? 'all' : limit,
    pages: showAll ? 1 : Math.max(Math.ceil(counts.n / limit), 1),
  };
}

export const getGame = (id) =>
  db.prepare(`SELECT ${SELECT_COLUMNS} FROM games WHERE id = ?`).get(id);

/** Recherche par code-barres, pour le scan depuis un telephone. */
export function findByEan(ean) {
  const clean = normalizeEan(ean);
  if (!clean) return [];
  return db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM games WHERE ean = ? ORDER BY id ASC`)
    .all(clean);
}

export function createGame(payload) {
  const data = normalizeGame(payload);
  const info = db
    .prepare(
      `INSERT INTO games (${COLUMNS.join(', ')})
       VALUES (${COLUMNS.map((c) => `@${c}`).join(', ')})`,
    )
    .run(data);
  return getGame(info.lastInsertRowid);
}

export function updateGame(id, payload) {
  const existing = getGame(id);
  if (!existing) return null;
  // Fusion : les champs absents de la requete gardent leur valeur actuelle.
  const data = normalizeGame({ ...existing, ...payload });
  db.prepare(
    `UPDATE games SET ${COLUMNS.map((c) => `${c} = @${c}`).join(', ')},
     updated_at = datetime('now') WHERE id = @id`,
  ).run({ ...data, id });
  return getGame(id);
}

export function deleteGame(id) {
  return db.prepare('DELETE FROM games WHERE id = ?').run(id).changes > 0;
}

/** Insertion en masse (import) dans une seule transaction. */
export const insertMany = db.transaction((rows) => {
  const stmt = db.prepare(
    `INSERT INTO games (${COLUMNS.join(', ')})
     VALUES (${COLUMNS.map((c) => `@${c}`).join(', ')})`,
  );
  for (const row of rows) stmt.run(row);
  return rows.length;
});

/**
 * Tout ce dont la barre laterale a besoin : valeurs distinctes pour les
 * filtres, et compteurs des vues rapides.
 */
export function getMeta() {
  const distinct = (column) =>
    db
      .prepare(
        `SELECT ${column} AS value, COUNT(*) AS count FROM games
          WHERE ${column} <> '' GROUP BY ${column} COLLATE NOCASE
          ORDER BY count DESC, value COLLATE NOCASE ASC`,
      )
      .all();

  const groupBy = (column) =>
    db
      .prepare(`SELECT ${column} AS label, COUNT(*) AS count FROM games GROUP BY ${column}`)
      .all();

  const tagCounts = new Map();
  for (const row of db.prepare("SELECT tags FROM games WHERE tags <> ''").all()) {
    for (const tag of row.tags.split(',')) {
      const clean = tag.trim();
      if (!clean) continue;
      tagCounts.set(clean, (tagCounts.get(clean) || 0) + 1);
    }
  }

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(quantity), 0) AS copies,
              SUM(CASE WHEN favorite = 1 THEN 1 ELSE 0 END) AS favorites,
              SUM(CASE WHEN has_iso = 0 THEN 1 ELSE 0 END) AS without_iso,
              SUM(CASE WHEN ${INCOMPLETE_SQL} THEN 1 ELSE 0 END) AS incomplete
         FROM games`,
    )
    .get();

  return {
    platforms: distinct('platform'),
    regions: distinct('region'),
    tags: [...tagCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    conditions: CONDITIONS,
    by_condition: groupBy('condition'),
    totals: {
      total: totals.total,
      copies: totals.copies,
      favorites: totals.favorites || 0,
      incomplete: totals.incomplete || 0,
      without_iso: totals.without_iso || 0,
    },
  };
}

export { COLUMNS, PARTS };
