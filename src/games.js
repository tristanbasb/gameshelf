import { db, CONDITIONS, FORMATS } from './db.js';

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

function optionalNumber(value, { min, max, integer = false, label }) {
  if (value === undefined || value === null || value === '') return null;
  const n = integer ? Number.parseInt(value, 10) : Number.parseFloat(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${label} : valeur numerique invalide`);
  if (min !== undefined && n < min) throw new ValidationError(`${label} : doit etre >= ${min}`);
  if (max !== undefined && n > max) throw new ValidationError(`${label} : doit etre <= ${max}`);
  return n;
}

function optionalDate(value, label) {
  if (!value) return null;
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ValidationError(`${label} : format attendu AAAA-MM-JJ`);
  }
  if (Number.isNaN(Date.parse(s))) throw new ValidationError(`${label} : date invalide`);
  return s;
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

/** Nettoie une URL de jaquette : http(s) externe, ou chemin /uploads/ local. */
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
  throw new ValidationError('Jaquette : URL invalide (http:// ou https:// attendu)');
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

  const format = str(input.format, 20).toLowerCase() || 'physical';
  if (!FORMATS.includes(format)) {
    throw new ValidationError(`Format invalide (valeurs possibles : ${FORMATS.join(', ')})`);
  }

  const quantity = optionalNumber(input.quantity, {
    min: 1, max: 9999, integer: true, label: 'Quantite',
  });

  return {
    title,
    platform: str(input.platform),
    developer: str(input.developer),
    publisher: str(input.publisher),
    release_year: optionalNumber(input.release_year, {
      min: 1950, max: 2100, integer: true, label: 'Annee de sortie',
    }),
    quantity: quantity ?? 1,
    condition,
    format,
    rating: optionalNumber(input.rating, { min: 0, max: 10, integer: true, label: 'Note' }),
    price: optionalNumber(input.price, { min: 0, max: 1000000, label: 'Prix' }),
    purchase_date: optionalDate(input.purchase_date, "Date d'achat"),
    favorite: input.favorite === true || input.favorite === 1 || input.favorite === '1' ? 1 : 0,
    cover_url: normalizeCoverUrl(input.cover_url),
    notes: str(input.notes, MAX_NOTES),
    tags: normalizeTags(input.tags),
  };
}

const COLUMNS = [
  'title', 'platform', 'developer', 'publisher', 'release_year',
  'quantity', 'condition', 'format', 'rating', 'price', 'purchase_date',
  'favorite', 'cover_url', 'notes', 'tags',
];

const SORTABLE = {
  title: 'title COLLATE NOCASE',
  platform: 'platform COLLATE NOCASE',
  quantity: 'quantity',
  release_year: 'release_year',
  rating: 'rating',
  price: 'price',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

export function listGames(query = {}) {
  const where = [];
  const params = {};

  if (query.search) {
    where.push(
      '(title LIKE @search OR developer LIKE @search OR publisher LIKE @search'
      + ' OR tags LIKE @search OR notes LIKE @search OR platform LIKE @search)',
    );
    params.search = `%${String(query.search).trim()}%`;
  }
  if (query.platform) {
    where.push('platform = @platform');
    params.platform = String(query.platform);
  }
  if (query.condition) {
    where.push('condition = @condition');
    params.condition = String(query.condition);
  }
  if (query.format) {
    where.push('format = @format');
    params.format = String(query.format);
  }
  if (query.favorite === '1' || query.favorite === true) {
    where.push('favorite = 1');
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

  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 60, 1), 500);
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;

  // better-sqlite3 refuse un objet de parametres pour une requete qui n'en
  // attend aucun : sans filtre actif, on appelle get() sans argument.
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(quantity), 0) AS copies FROM games ${whereSql}`,
  );
  const counts = Object.keys(params).length ? countStmt.get(params) : countStmt.get();

  const items = db
    .prepare(`SELECT * FROM games ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  return {
    items,
    total: counts.n,
    copies: counts.copies,
    page,
    limit,
    pages: Math.max(Math.ceil(counts.n / limit), 1),
  };
}

export const getGame = (id) => db.prepare('SELECT * FROM games WHERE id = ?').get(id);

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

/** Valeurs distinctes utilisees par les filtres de l'interface. */
export function getMeta() {
  const distinct = (column) =>
    db
      .prepare(
        `SELECT ${column} AS value, COUNT(*) AS count FROM games
          WHERE ${column} <> '' GROUP BY ${column} COLLATE NOCASE
          ORDER BY count DESC, value COLLATE NOCASE ASC`,
      )
      .all();

  const tagCounts = new Map();
  for (const row of db.prepare("SELECT tags FROM games WHERE tags <> ''").all()) {
    for (const tag of row.tags.split(',')) {
      const clean = tag.trim();
      if (!clean) continue;
      tagCounts.set(clean, (tagCounts.get(clean) || 0) + 1);
    }
  }

  return {
    platforms: distinct('platform'),
    developers: distinct('developer'),
    tags: [...tagCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    conditions: CONDITIONS,
    formats: FORMATS,
  };
}

export function getStats() {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*)                                       AS total,
         COALESCE(SUM(quantity), 0)                     AS copies,
         COALESCE(SUM(price * quantity), 0)             AS total_spent,
         COUNT(rating)                                  AS rated_count,
         COALESCE(AVG(rating), 0)                       AS avg_rating,
         SUM(CASE WHEN favorite = 1 THEN 1 ELSE 0 END)  AS favorites,
         SUM(CASE WHEN quantity > 1 THEN 1 ELSE 0 END)  AS duplicates,
         COUNT(DISTINCT CASE WHEN platform <> '' THEN platform END) AS platform_count
       FROM games`,
    )
    .get();

  const groupBy = (column) =>
    db
      .prepare(
        `SELECT CASE WHEN ${column} = '' THEN '' ELSE ${column} END AS label,
                COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS copies
           FROM games GROUP BY label ORDER BY count DESC, label ASC`,
      )
      .all();

  return {
    ...totals,
    by_platform: groupBy('platform'),
    by_condition: groupBy('condition'),
    by_format: groupBy('format'),
    by_year: db
      .prepare(
        `SELECT release_year AS label, COUNT(*) AS count FROM games
          WHERE release_year IS NOT NULL GROUP BY release_year ORDER BY release_year ASC`,
      )
      .all(),
    top_rated: db
      .prepare(
        `SELECT id, title, platform, rating, cover_url FROM games
          WHERE rating IS NOT NULL ORDER BY rating DESC, title COLLATE NOCASE ASC LIMIT 10`,
      )
      .all(),
    most_copies: db
      .prepare(
        `SELECT id, title, platform, quantity FROM games
          WHERE quantity > 1 ORDER BY quantity DESC, title COLLATE NOCASE ASC LIMIT 10`,
      )
      .all(),
    recent: db
      .prepare(
        'SELECT id, title, platform, cover_url, created_at FROM games ORDER BY id DESC LIMIT 10',
      )
      .all(),
  };
}

export { COLUMNS };
