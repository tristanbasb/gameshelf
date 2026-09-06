#!/usr/bin/env node
/**
 * Reinitialise le mot de passe d'un compte GameShelf.
 *
 *   node scripts/reset-password.js                      -> admin, mot de passe aleatoire
 *   node scripts/reset-password.js alice                -> alice, mot de passe aleatoire
 *   node scripts/reset-password.js alice monMotDePasse  -> mot de passe impose
 *
 * En Docker :
 *   docker compose exec gameshelf node scripts/reset-password.js
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../src/db.js';

const [, , usernameArg, passwordArg] = process.argv;
const username = usernameArg || 'admin';
const password = passwordArg || crypto.randomBytes(12).toString('base64url');

if (passwordArg && passwordArg.length < 8) {
  console.error('Erreur : le mot de passe doit faire au moins 8 caracteres.');
  process.exit(1);
}

const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);

if (user) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(password, 12),
    user.id,
  );
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  console.log(`Mot de passe de "${username}" reinitialise. Sessions existantes revoquees.`);
} else {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    username,
    bcrypt.hashSync(password, 12),
  );
  console.log(`Compte "${username}" cree.`);
}

console.log('');
console.log(`  Identifiant  : ${username}`);
console.log(`  Mot de passe : ${password}`);
console.log('');

db.close();
