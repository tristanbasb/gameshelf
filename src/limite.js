/*
 * Limite de debit, tenue en memoire.
 *
 * L'application n'a pas d'authentification : c'est le compromis assume d'une
 * installation domestique, mais il laisse l'API ouverte a tout appareil du
 * reseau. Sans garde-fou, une boucle maladroite ou un appareil qui s'emballe
 * peut remplir le disque de jaquettes, ou tenir le service occupe a copier la
 * base en boucle.
 *
 * Les plafonds sont volontairement larges : il ne s'agit pas de rationner un
 * usage normal — consulter la collection fait une dizaine de requetes, un
 * scan deux ou trois — mais d'arreter l'emballement.
 */

/** Fenetres glissantes, par cle (nom de la limite + adresse de l'appelant). */
const fenetres = new Map();

/*
 * Les fenetres vides sont oubliees periodiquement : sans cela, chaque adresse
 * rencontree resterait en memoire jusqu'au redemarrage.
 */
const PURGE_MS = 10 * 60 * 1000;
setInterval(() => {
  const maintenant = Date.now();
  for (const [cle, horodatages] of fenetres) {
    if (!horodatages.length || maintenant - horodatages[horodatages.length - 1] > PURGE_MS) {
      fenetres.delete(cle);
    }
  }
}, PURGE_MS).unref();

/**
 * Intercepteur Express refusant les requetes au-dela de `max` sur `secondes`.
 *
 * `nom` separe les compteurs : le plafond des televersements ne doit pas etre
 * entame par la simple consultation de la collection.
 */
export function limite({ nom, max, secondes, message }) {
  const dureeMs = secondes * 1000;

  return function appliquerLimite(req, res, next) {
    const cle = `${nom}:${req.ip || 'inconnu'}`;
    const maintenant = Date.now();
    const horodatages = fenetres.get(cle) || [];

    // On ne garde que les appels encore dans la fenetre.
    let debut = 0;
    while (debut < horodatages.length && maintenant - horodatages[debut] > dureeMs) debut += 1;
    const recents = debut ? horodatages.slice(debut) : horodatages;

    if (recents.length >= max) {
      const attente = Math.ceil((dureeMs - (maintenant - recents[0])) / 1000);
      fenetres.set(cle, recents);
      res.setHeader('Retry-After', String(Math.max(attente, 1)));
      return res.status(429).json({ error: message || 'Trop de requetes, patientez un instant' });
    }

    recents.push(maintenant);
    fenetres.set(cle, recents);
    next();
  };
}

export default limite;
