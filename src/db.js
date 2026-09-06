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
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE games (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        title         TEXT    NOT NULL,
        platform      TEXT    NOT NULL DEFAULT '',
        developer     TEXT    NOT NULL DEFAULT '',
        publisher     TEXT    NOT NULL DEFAULT '',
        release_year  INTEGER,
        quantity      INTEGER NOT NULL DEFAULT 1,
        condition     TEXT    NOT NULL DEFAULT '',
        format        TEXT    NOT NULL DEFAULT 'physical',
        rating        INTEGER,
        price         REAL,
        purchase_date TEXT,
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

export const FORMATS = ['physical', 'digital'];

export default db;
