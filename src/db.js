import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.dbFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * Migrations incrementales basees sur PRAGMA user_version.
 * Pour faire evoluer le schema : ajouter une fonction a la fin du tableau,
 * ne jamais modifier ni supprimer les precedentes.
 */
const migrations = [
  function initialSchema() {
    db.exec(`
      CREATE TABLE games (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        title         TEXT    NOT NULL,
        platform      TEXT    NOT NULL DEFAULT '',

        -- Code-barres du boitier, utilise pour le scan depuis un telephone.
        ean           TEXT    NOT NULL DEFAULT '',

        quantity      INTEGER NOT NULL DEFAULT 1,
        condition     TEXT    NOT NULL DEFAULT '',

        -- Completude d'un exemplaire.
        has_box       INTEGER NOT NULL DEFAULT 1,
        has_cover_art INTEGER NOT NULL DEFAULT 1,
        has_manual    INTEGER NOT NULL DEFAULT 1,
        has_disc      INTEGER NOT NULL DEFAULT 1,

        favorite      INTEGER NOT NULL DEFAULT 0,
        cover_url     TEXT    NOT NULL DEFAULT '',
        notes         TEXT    NOT NULL DEFAULT '',
        tags          TEXT    NOT NULL DEFAULT '',
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_games_title     ON games(title COLLATE NOCASE);
      CREATE INDEX idx_games_platform  ON games(platform);
      CREATE INDEX idx_games_condition ON games(condition);
      CREATE INDEX idx_games_ean       ON games(ean);
    `);
  },
];

const currentVersion = db.pragma('user_version', { simple: true });
if (currentVersion < migrations.length) {
  const applyAll = db.transaction(() => {
    for (let i = currentVersion; i < migrations.length; i += 1) {
      migrations[i]();
    }
    db.pragma(`user_version = ${migrations.length}`);
  });
  applyAll();
}

/** Etat d'un exemplaire, du meilleur au plus abime. '' = non renseigne. */
export const CONDITIONS = ['sealed', 'mint', 'good', 'fair', 'poor'];

/** Elements dont on suit la presence dans un exemplaire. */
export const PARTS = ['has_box', 'has_cover_art', 'has_manual', 'has_disc'];

export default db;
