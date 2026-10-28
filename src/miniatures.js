/*
 * Miniatures des jaquettes.
 *
 * Les jaquettes viennent de partout — boutiques, sites d'encheres, bases de
 * donnees — et souvent en 1300 a 1600 pixels de large. Sur un telephone, la
 * grille en decode deux cents pour les afficher sur cent vingt pixels. Et hors
 * ligne, en magasin, elles manquent toutes : un service worker ne peut pas
 * garder la reponse d'un autre site, elle lui reste opaque.
 *
 * Le serveur va donc chercher chaque image une fois, la reduit, et garde le
 * resultat dans data/thumbs. Servie depuis la meme origine, la miniature pese
 * quelques dizaines de kilo-octets, se garde un mois dans le navigateur, et le
 * service worker peut la conserver pour le magasin. La fiche d'un jeu, elle,
 * continue d'afficher l'image d'origine.
 *
 * Aller chercher une adresse fournie par l'utilisateur, c'est preter le
 * serveur a qui la fournit. D'ou les garde-fous :
 *   - seule une image deja utilisee par une fiche est servie : la route n'est
 *     pas un relais vers n'importe quelle adresse ;
 *   - les adresses du reseau local, de la machine elle-meme ou reservees sont
 *     refusees, a chaque redirection, et verifiees au moment meme de la
 *     connexion — un nom qui changerait d'adresse entre la verification et
 *     l'appel ne passe pas ;
 *   - le telechargement est borne en duree comme en taille ;
 *   - le contenu doit etre une image, lue dans ses premiers octets, et ses
 *     dimensions declarees sont plafonnees avant tout decodage.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { db } from './db.js';
import { config } from './config.js';
import { typeImageReel } from './images.js';

/*
 * Taille cible. La case d'une jaquette est au format 3:4 et l'image la remplit
 * en entier (object-fit: cover) : la miniature doit donc couvrir 360 × 480
 * sans etre etiree, soit trois pixels physiques par point sur la grille d'un
 * telephone. Une image moins grande n'est jamais agrandie.
 */
const LARGEUR = 360;
const HAUTEUR = 480;
const QUALITE = 78;

/** Temps accorde a l'hebergeur pour livrer l'image, redirections comprises. */
const DELAI_MS = 10_000;

/** Au-dela, ce n'est plus une jaquette : on n'en lit pas davantage. */
const TAILLE_MAX = 8 * 1024 * 1024;

/*
 * Plafond des dimensions declarees, verifie avant de decoder : quelques
 * kilo-octets de PNG peuvent annoncer une image de plusieurs gigaoctets une
 * fois decompressee. Une photo de telephone tient en 50 megapixels.
 */
const PIXELS_MAX = 50_000_000;

const REDIRECTIONS_MAX = 3;
const CODES_REDIRECTION = new Set([301, 302, 303, 307, 308]);

/*
 * Reductions menees en meme temps. Chacune decode une image entiere en
 * memoire : sur un petit serveur, mieux vaut les faire patienter que les
 * laisser s'empiler.
 */
const SIMULTANEES = 3;

/*
 * Un echec est retenu une demi-heure : une jaquette introuvable chez son
 * hebergeur n'est pas redemandee a chaque affichage de la grille.
 */
const OUBLI_ECHEC_MS = 30 * 60 * 1000;

/** Une miniature sans fiche n'est retiree qu'apres ce delai (voir le balayage). */
const DELAI_GRACE_MS = 60 * 60 * 1000;

const CACHE_NAVIGATEUR = { maxAge: '30d', immutable: true };

/*
 * La bibliotheque de reduction est la seule dependance native de ce module.
 * Ses binaires sont precompiles pour Windows, macOS et Linux (x64 comme ARM) ;
 * la ou elle ne se charge pas, l'interface affiche les images d'origine.
 */
let sharp = null;
try {
  sharp = (await import('sharp')).default;
  // Chaque image n'est reduite qu'une fois : le cache de libvips ne servirait
  // qu'a garder en memoire des images que l'on ne reverra pas.
  sharp.cache(false);
} catch (err) {
  console.warn(`  ! Miniatures indisponibles (sharp : ${err.message.split('\n')[0]}).`);
  console.warn('    La grille affichera les jaquettes d origine.');
}

/* --------------------------------------------------------------------------
 * Adresses refusees
 * ----------------------------------------------------------------------- */

const RESEAUX_INTERDITS = new net.BlockList();
for (const [adresse, prefixe] of [
  ['0.0.0.0', 8], //       « ce reseau »
  ['10.0.0.0', 8], //      prive
  ['100.64.0.0', 10], //   partage, derriere le NAT d'un operateur
  ['127.0.0.0', 8], //     la machine elle-meme
  ['169.254.0.0', 16], //  lien local, dont les metadonnees des hebergeurs cloud
  ['172.16.0.0', 12], //   prive
  ['192.0.0.0', 24], //    reserve
  ['192.0.2.0', 24], //    documentation
  ['192.168.0.0', 16], //  prive : la box, l'imprimante, le NAS
  ['198.18.0.0', 15], //   bancs d'essai
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], //  documentation
  ['224.0.0.0', 4], //     multidiffusion
  ['240.0.0.0', 4], //     reserve, et diffusion generale
]) {
  RESEAUX_INTERDITS.addSubnet(adresse, prefixe, 'ipv4');
}
for (const [adresse, prefixe] of [
  ['::', 96], //       non specifiee, boucle locale, IPv4 « compatible »
  ['100::', 64], //    a jeter
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], //    locale unique : l'equivalent des adresses privees
  ['fe80::', 10], //   lien local
  ['ff00::', 8], //    multidiffusion
]) {
  RESEAUX_INTERDITS.addSubnet(adresse, prefixe, 'ipv6');
}
// Les adresses IPv4 ecrites en IPv6 (::ffff:192.168.1.1) sont comparees aux
// regles IPv4 par BlockList elle-meme.

/** Vrai pour une adresse IP que le serveur ne doit pas contacter. */
export function adresseInterdite(adresse) {
  const famille = net.isIP(adresse);
  if (!famille) return true;
  return RESEAUX_INTERDITS.check(adresse, famille === 6 ? 'ipv6' : 'ipv4');
}

/** Echec de fabrication d'une miniature, avec le code HTTP a renvoyer. */
class ErreurMiniature extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const refusLocal = (hote) =>
  new ErreurMiniature(`Adresse du reseau local refusee (${hote})`, 403);

/*
 * Resolution de nom utilisee par la connexion elle-meme : l'adresse verifiee
 * est celle que l'on contacte, sans seconde resolution qui pourrait repondre
 * autre chose. Un nom dont une seule adresse est locale est refuse en entier.
 */
function resolutionSure(nom, options, rappel) {
  dns.lookup(nom, { ...options, all: true }, (err, adresses) => {
    if (err) return rappel(err);
    if (!adresses.length || adresses.some((a) => adresseInterdite(a.address))) {
      return rappel(refusLocal(nom));
    }
    if (options.all) return rappel(null, adresses);
    return rappel(null, adresses[0].address, adresses[0].family);
  });
}

/** Refuse ce qui peut l'etre avant toute connexion. */
function verifierAdresse(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ErreurMiniature('Seules les adresses http et https sont suivies', 400);
  }
  // Une adresse IP ecrite en clair ne passe pas par la resolution de nom :
  // elle est verifiee ici. L'analyseur d'URL a deja ramene les ecritures
  // detournees (2130706433, 0x7f.1) a leur forme usuelle.
  const hote = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hote) && adresseInterdite(hote)) throw refusLocal(hote);
}

/* --------------------------------------------------------------------------
 * Telechargement
 * ----------------------------------------------------------------------- */

const version = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')).version;
  } catch {
    return '';
  }
})();

function requete(url, signal) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, {
      lookup: resolutionSure,
      signal,
      headers: {
        // Les formats que la reduction sait lire, et rien qui oblige
        // l'hebergeur a renvoyer une page HTML.
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1',
        'User-Agent': `GameVault/${version} (miniatures de jaquettes)`,
      },
    }, resolve);
    req.on('error', reject);
  });
}

/** Contenu d'une image distante, redirections suivies et verifiees une a une. */
async function telecharger(adresse) {
  const signal = AbortSignal.timeout(DELAI_MS);
  try {
    return await suivre(new URL(adresse), signal);
  } catch (err) {
    if (err instanceof ErreurMiniature) throw err;
    // Le delai coupe la connexion : selon le moment, l'erreur dit « aborted »,
    // « socket hang up » ou AbortError. Le signal, lui, sait ce qui s'est passe.
    if (signal.aborted) {
      throw new ErreurMiniature(`L hebergeur de l image n a pas repondu en ${DELAI_MS / 1000} s`, 504);
    }
    if (err.cause instanceof ErreurMiniature) throw err.cause;
    throw new ErreurMiniature(`Image injoignable (${err.code || err.message})`);
  }
}

async function suivre(depart, signal) {
  let url = depart;
  for (let redirections = 0; ; redirections += 1) {
    verifierAdresse(url);
    const reponse = await requete(url, signal);

    if (CODES_REDIRECTION.has(reponse.statusCode) && reponse.headers.location) {
      reponse.resume();
      if (redirections >= REDIRECTIONS_MAX) throw new ErreurMiniature('Trop de redirections');
      url = new URL(reponse.headers.location, url);
      continue;
    }
    if (reponse.statusCode !== 200) {
      reponse.resume();
      throw new ErreurMiniature(`L hebergeur de l image a repondu ${reponse.statusCode}`);
    }

    const tropGros = () => new ErreurMiniature(
      `Image trop volumineuse (plus de ${TAILLE_MAX / 1024 / 1024} Mo)`,
    );
    if (Number(reponse.headers['content-length']) > TAILLE_MAX) {
      reponse.destroy();
      throw tropGros();
    }
    // La longueur annoncee n'engage personne : on compte aussi ce qui arrive.
    const morceaux = [];
    let total = 0;
    for await (const morceau of reponse) {
      total += morceau.length;
      if (total > TAILLE_MAX) {
        reponse.destroy();
        throw tropGros();
      }
      morceaux.push(morceau);
    }
    return Buffer.concat(morceaux);
  }
}

/** Contenu de l'image source : televersee ici, ou hebergee ailleurs. */
async function lireSource(src) {
  if (src.startsWith('/uploads/')) {
    // Le nom seul : la base n'en contient pas d'autre, mais un chemin ne
    // sortira de toute facon pas du dossier des jaquettes.
    try {
      return await fsp.readFile(path.join(config.uploadsDir, path.basename(src)));
    } catch {
      throw new ErreurMiniature('Image televersee introuvable', 404);
    }
  }
  return telecharger(src);
}

/* --------------------------------------------------------------------------
 * Reduction
 * ----------------------------------------------------------------------- */

async function reduire(source) {
  // Le type annonce par l'hebergeur n'engage a rien : on lit l'entete.
  if (!typeImageReel(source)) {
    throw new ErreurMiniature('Le contenu recu n est pas une image reconnue');
  }
  try {
    return await sharp(source, {
      limitInputPixels: PIXELS_MAX,
      // Une image legerement abimee s'affiche dans le navigateur : elle doit
      // aussi donner une miniature. Seules les erreurs franches arretent.
      failOn: 'error',
    })
      // Les photos de telephone portent leur orientation dans l'EXIF, que la
      // miniature perdrait avec les autres metadonnees.
      .autoOrient()
      .resize({ width: LARGEUR, height: HAUTEUR, fit: 'outside', withoutEnlargement: true })
      .webp({ quality: QUALITE })
      .toBuffer();
  } catch (err) {
    throw new ErreurMiniature(`Image illisible (${err.message.split('\n')[0]})`);
  }
}

/* --------------------------------------------------------------------------
 * Fichiers et file d'attente
 * ----------------------------------------------------------------------- */

/** Nom de fichier de la miniature d'une image source. */
const nomDe = (src) => `${crypto.createHash('sha256').update(src).digest('hex').slice(0, 32)}.webp`;

const jaquetteConnue = db.prepare('SELECT 1 FROM games WHERE cover_url = ? LIMIT 1');

/** Echecs recents, par nom de fichier : { jusqua, status, message }. */
const echecs = new Map();

/** Miniatures en cours de fabrication, par nom : une seule fois chacune. */
const enCours = new Map();

let actives = 0;
const enAttente = [];

async function aTonTour(tache) {
  if (actives >= SIMULTANEES) await new Promise((resolve) => enAttente.push(resolve));
  actives += 1;
  try {
    return await tache();
  } finally {
    actives -= 1;
    enAttente.shift()?.();
  }
}

async function fabriquer(src, fichier) {
  const miniature = await aTonTour(async () => reduire(await lireSource(src)));
  // Ecrite a cote puis renommee : une lecture concurrente ne voit jamais un
  // fichier a moitie ecrit.
  const provisoire = `${fichier}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(provisoire, miniature);
    await fsp.rename(provisoire, fichier);
  } catch (err) {
    // Disque plein ou en lecture seule : la miniature est servie quand meme,
    // elle sera refaite a la prochaine demande.
    await fsp.rm(provisoire, { force: true }).catch(() => {});
    console.warn(`  ! Miniature non enregistree : ${err.message}`);
  }
  return miniature;
}

/*
 * Causes d'echec deja ecrites dans le journal. Un hebergeur qui refuse les
 * telechargements les refuse tous : une ligne suffit, pas une par jaquette.
 */
const signalees = new Map();

function signaler(src, message) {
  let hote = 'televersement';
  try {
    hote = new URL(src).hostname;
  } catch {
    /* image televersee */
  }
  const cause = `${hote} : ${message}`;
  if (signalees.get(cause) > Date.now()) return;
  if (signalees.size > 500) signalees.clear();
  signalees.set(cause, Date.now() + OUBLI_ECHEC_MS);
  console.warn(`  ! Miniature impossible (${cause})`);
}

const refuser = (res, status, message) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error: message });
};

/* --------------------------------------------------------------------------
 * Routes
 * ----------------------------------------------------------------------- */

/**
 * GET /thumbs?src=<adresse de la jaquette>, premiere etape : sert la
 * miniature si elle existe deja, refuse ce qui ne doit pas etre fabrique, et
 * laisse la suite (limite de debit, fabrication) au gestionnaire suivant.
 */
export function miniatureExistante(req, res, next) {
  const src = typeof req.query.src === 'string' ? req.query.src : '';
  if (!src || src.length > 1000) return refuser(res, 400, 'Parametre src attendu');
  if (!jaquetteConnue.get(src)) {
    return refuser(res, 404, 'Aucune fiche n utilise cette image');
  }

  const nom = nomDe(src);
  const fichier = path.join(config.thumbsDir, nom);
  fs.stat(fichier, (err, etat) => {
    if (!err && etat.isFile()) {
      // Le nom seul, sous `root` : la regle des fichiers caches ne porte alors
      // que sur lui. Sur le chemin complet, un dossier de donnees range sous
      // un dossier a point (~/.local, .test-…) faisait refuser chaque miniature.
      return res.sendFile(nom, { ...CACHE_NAVIGATEUR, root: config.thumbsDir, dotfiles: 'deny' });
    }
    const echec = echecs.get(nom);
    if (echec && echec.jusqua > Date.now()) return refuser(res, echec.status, echec.message);
    if (!sharp) return refuser(res, 503, 'Miniatures indisponibles sur ce serveur');
    res.locals.miniature = { src, nom, fichier };
    return next();
  });
}

/** Seconde etape : fabrique la miniature, puis la sert. */
export async function fabriquerMiniature(_req, res) {
  const { src, nom, fichier } = res.locals.miniature;
  let travail = enCours.get(nom);
  if (!travail) {
    travail = fabriquer(src, fichier).finally(() => enCours.delete(nom));
    enCours.set(nom, travail);
  }

  try {
    const miniature = await travail;
    res.setHeader('Cache-Control', `public, max-age=${30 * 24 * 3600}, immutable`);
    res.type('webp').send(miniature);
  } catch (err) {
    const status = err instanceof ErreurMiniature ? err.status : 500;
    const message = err instanceof ErreurMiniature ? err.message : 'Miniature impossible';
    signaler(src, message);
    // La memoire des echecs ne doit pas grossir sans fin.
    if (echecs.size > 2000) echecs.clear();
    echecs.set(nom, { jusqua: Date.now() + OUBLI_ECHEC_MS, status, message });
    refuser(res, status, message);
  }
}

/* --------------------------------------------------------------------------
 * Entretien
 * ----------------------------------------------------------------------- */

/**
 * Supprime les miniatures qu'aucune fiche ne reclame plus : jaquette changee,
 * jeu efface, collection remplacee. Le delai de grace laisse a « Annuler »
 * le temps de rendre sa fiche a un jeu. Renvoie le nombre de fichiers retires.
 */
export function balayerMiniatures() {
  let retires = 0;
  try {
    const attendues = new Set();
    for (const { cover_url: src } of db
      .prepare("SELECT DISTINCT cover_url FROM games WHERE cover_url <> ''")
      .all()) {
      attendues.add(nomDe(src));
    }

    const maintenant = Date.now();
    for (const nom of fs.readdirSync(config.thumbsDir)) {
      if (attendues.has(nom)) continue;
      const fichier = path.join(config.thumbsDir, nom);
      try {
        const etat = fs.statSync(fichier);
        if (!etat.isFile() || maintenant - etat.mtimeMs < DELAI_GRACE_MS) continue;
        fs.rmSync(fichier, { force: true });
        retires += 1;
      } catch {
        /* fichier disparu entre-temps */
      }
    }
  } catch {
    /* dossier absent ou illisible : rien a entretenir */
  }
  return retires;
}
