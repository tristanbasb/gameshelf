import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config, localAddresses } from './config.js';

/*
 * Certificat auto-signe pour l'usage local.
 *
 * Les navigateurs refusent l'acces a la camera sur une origine non securisee.
 * Sur un reseau local, sans nom de domaine, la seule facon d'obtenir un
 * contexte securise est un certificat auto-signe : le telephone affichera un
 * avertissement a la premiere visite, puis le scan fonctionnera.
 */

const KEY_FILE = path.join(config.tlsDir, 'key.pem');
const CERT_FILE = path.join(config.tlsDir, 'cert.pem');
const SAN_FILE = path.join(config.tlsDir, 'san.txt');

/** Liste des noms et adresses que le certificat doit couvrir. */
function buildSan() {
  const entries = ['DNS:localhost', 'IP:127.0.0.1', 'IP:::1'];
  for (const address of localAddresses()) entries.push(`IP:${address}`);
  return entries.join(',');
}

function opensslAvailable() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function generate(san) {
  fs.mkdirSync(config.tlsDir, { recursive: true });
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256',
      '-days', '3650',
      '-keyout', KEY_FILE,
      '-out', CERT_FILE,
      '-subj', '/CN=GameVault',
      '-addext', `subjectAltName=${san}`,
      '-addext', 'basicConstraints=critical,CA:FALSE',
      '-addext', 'keyUsage=digitalSignature,keyEncipherment',
      '-addext', 'extendedKeyUsage=serverAuth',
    ],
    { stdio: 'ignore' },
  );
  fs.writeFileSync(SAN_FILE, san);
  try {
    fs.chmodSync(KEY_FILE, 0o600);
  } catch {
    /* systeme de fichiers sans permissions POSIX */
  }
}

/**
 * Renvoie { key, cert } pour https.createServer, ou null si le HTTPS local
 * est desactive ou impossible (openssl absent). Le certificat est cree au
 * premier demarrage, puis regenere uniquement si l'adresse IP de la machine
 * a change : un certificat qui ne couvre plus l'adresse utilisee rendrait le
 * scan inutilisable.
 */
export function loadOrCreateCertificate() {
  if (!config.https) return null;

  const san = buildSan();
  const exists = fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE);
  const previousSan = exists && fs.existsSync(SAN_FILE)
    ? fs.readFileSync(SAN_FILE, 'utf8').trim()
    : '';

  // On ne regenere que si une adresse actuelle n'est pas couverte : eviter de
  // changer le certificat sans raison, le telephone devrait le reaccepter.
  const covered = san
    .split(',')
    .every((entry) => previousSan.split(',').includes(entry));

  if (!exists || !covered) {
    if (!opensslAvailable()) {
      console.warn(
        '  ! openssl introuvable : demarrage en HTTP simple.\n'
        + '    Le scan par camera sera indisponible depuis un telephone.\n'
        + '    Installez openssl (sudo apt install openssl) puis redemarrez.',
      );
      return null;
    }
    try {
      generate(san);
      console.log(exists
        ? "  Certificat regenere : l'adresse IP de la machine a change."
        : '  Certificat local genere.');
    } catch (err) {
      console.warn(`  ! Generation du certificat impossible (${err.message}), passage en HTTP.`);
      return null;
    }
  }

  try {
    return { key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE) };
  } catch (err) {
    console.warn(`  ! Lecture du certificat impossible (${err.message}), passage en HTTP.`);
    return null;
  }
}

export { CERT_FILE, KEY_FILE };
