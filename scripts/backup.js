#!/usr/bin/env node
/**
 * Sauvegarde coherente de la base, sans arreter le service.
 *
 *   node scripts/backup.js [dossier_destination]
 *
 * Conserve les 14 sauvegardes les plus recentes. Exemple de tache cron :
 *   0 3 * * * cd /opt/gameshelf && /usr/bin/node scripts/backup.js >> /var/log/gameshelf-backup.log 2>&1
 */
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db.js';
import { config } from '../src/config.js';

const KEEP = 14;
const targetDir = path.resolve(process.argv[2] || path.join(config.root, 'backups'));

fs.mkdirSync(targetDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(targetDir, `gameshelf-${stamp}.db`);

await db.backup(target);
const size = (fs.statSync(target).size / 1024 / 1024).toFixed(2);
console.log(`[${new Date().toISOString()}] Sauvegarde ecrite : ${target} (${size} Mo)`);

// Rotation : on ne garde que les KEEP fichiers les plus recents.
const backups = fs
  .readdirSync(targetDir)
  .filter((name) => /^gameshelf-.*\.db$/.test(name))
  .sort()
  .reverse();

for (const stale of backups.slice(KEEP)) {
  fs.rmSync(path.join(targetDir, stale), { force: true });
  console.log(`  ancienne sauvegarde supprimee : ${stale}`);
}

db.close();
