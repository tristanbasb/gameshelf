/*
 * Entretien du dossier des jaquettes televersees.
 *
 * Rien ne supprimait jamais une image : effacer un jeu, changer sa jaquette ou
 * remplacer la collection par un import laissait le fichier sur le disque pour
 * toujours. Un televersement interrompu en laissait un aussi.
 *
 * Plutot que de supprimer au moment de l'effacement d'une fiche — ce qui
 * priverait de sa jaquette un jeu restaure par « Annuler », et effacerait une
 * image televersee a l'instant dans un formulaire pas encore enregistre — on
 * balaie periodiquement : est orpheline une image qu'aucune fiche ne reclame
 * et que personne ne vient de deposer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';

/*
 * Delai de grace avant qu'un fichier puisse etre considere comme orphelin.
 *
 * Une image est televersee avant que la fiche qui l'utilise n'existe : entre
 * les deux, elle n'est reclamee par personne. Une heure laisse le temps de
 * remplir un formulaire, et couvre largement les neuf secondes pendant
 * lesquelles une suppression reste annulable.
 */
const DELAI_GRACE_MS = 60 * 60 * 1000;

/** Toutes les heures : assez pour ne pas laisser le dossier deriver. */
const PERIODE_MS = 60 * 60 * 1000;

/** Images reclamees par au moins une fiche, par nom de fichier. */
function jaquettesUtilisees() {
  const noms = new Set();
  for (const { cover_url: url } of db
    .prepare("SELECT cover_url FROM games WHERE cover_url LIKE '/uploads/%'")
    .all()) {
    noms.add(path.basename(url));
  }
  return noms;
}

/**
 * Supprime les images orphelines. Renvoie le nombre de fichiers retires.
 * Toute erreur est avalee : l'entretien ne doit jamais empecher le service de
 * fonctionner.
 */
export function balayerJaquettes() {
  let retires = 0;
  try {
    const utilisees = jaquettesUtilisees();
    const maintenant = Date.now();

    for (const nom of fs.readdirSync(config.uploadsDir)) {
      if (utilisees.has(nom)) continue;
      const fichier = path.join(config.uploadsDir, nom);
      try {
        const etat = fs.statSync(fichier);
        if (!etat.isFile()) continue;
        // Depose a l'instant : la fiche qui l'utilisera n'existe peut-etre
        // pas encore.
        if (maintenant - etat.mtimeMs < DELAI_GRACE_MS) continue;
        fs.rmSync(fichier, { force: true });
        retires += 1;
      } catch {
        /* fichier disparu entre-temps, ou illisible */
      }
    }
  } catch {
    /* dossier absent ou illisible : rien a entretenir */
  }
  return retires;
}

/**
 * Vide les fichiers de passage : copies de la base preparees pour un
 * telechargement que personne n'a mene a son terme. Ils ne servent qu'a la
 * requete qui les cree.
 */
export function viderFichiersDePassage() {
  let retires = 0;
  try {
    for (const nom of fs.readdirSync(config.tmpDir)) {
      const fichier = path.join(config.tmpDir, nom);
      try {
        const etat = fs.statSync(fichier);
        if (!etat.isFile()) continue;
        if (Date.now() - etat.mtimeMs < DELAI_GRACE_MS) continue;
        fs.rmSync(fichier, { force: true });
        retires += 1;
      } catch {
        /* fichier disparu entre-temps */
      }
    }
  } catch {
    /* dossier absent */
  }
  return retires;
}

/** Lance l'entretien au demarrage, puis a intervalle regulier. */
export function demarrerEntretien() {
  const passer = () => {
    const jaquettes = balayerJaquettes();
    if (jaquettes) console.log(`  ${jaquettes} jaquette(s) orpheline(s) supprimee(s)`);
    const passages = viderFichiersDePassage();
    if (passages) console.log(`  ${passages} fichier(s) de passage supprime(s)`);
  };
  passer();
  setInterval(passer, PERIODE_MS).unref();
}
