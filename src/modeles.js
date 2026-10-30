/*
 * Modeles Claude proposes, et celui que l'on a choisi pour chaque usage.
 *
 * Identifier un jeu et discuter ont chacun leur modele : on peut garder Opus
 * pour une identification qu'il faut juste, et discuter avec Haiku pour
 * presque rien. Le choix se fait dans le menu Plus et vit dans la base, pour
 * tous les appareils. Tant qu'il n'est pas fait : ANTHROPIC_MODEL du fichier
 * .env, sinon Claude Opus 5.5.
 *
 * Les modeles n'acceptent pas tous les memes options. La table dit, pour
 * chacun, quelle version de la recherche web il connait (le filtrage des
 * resultats n'existe pas sur Haiku) et s'il a un modele de repli quand ses
 * garde-fous declinent une demande (Haiku n'en a pas).
 */
import { db } from './db.js';
import { config } from './config.js';

export const MODELES = [
  { id: 'claude-fable-5-1', nom: 'Claude Fable 5.1', prix: '10 $ / 50 $', recherche: 'web_search_20260209', repli: true },
  { id: 'claude-opus-5-5', nom: 'Claude Opus 5.5', prix: '4 $ / 20 $', recherche: 'web_search_20260209', repli: true },
  { id: 'claude-sonnet-5-5', nom: 'Claude Sonnet 5.5', prix: '2 $ / 10 $', recherche: 'web_search_20260209', repli: true },
  { id: 'claude-haiku-5-5', nom: 'Claude Haiku 5.5', prix: '0,10 $ / 0,50 $', recherche: 'web_search_20250305', repli: false },
];

/** Usages qui ont chacun leur modele. */
export const USAGES = ['identify', 'chat'];

const PAR_DEFAUT = 'claude-opus-5-5';
const parId = new Map(MODELES.map((m) => [m.id, m]));

if (config.anthropicModel && !parId.has(config.anthropicModel)) {
  console.warn(
    `[attention] ANTHROPIC_MODEL=${config.anthropicModel} n'est pas un modele propose `
    + `(${MODELES.map((m) => m.id).join(', ')}) : ${PAR_DEFAUT} le remplace.`,
  );
}
const defaut = parId.get(config.anthropicModel) || parId.get(PAR_DEFAUT);

const lire = db.prepare('SELECT value FROM settings WHERE key = ?');
const ecrire = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
);

/** Le modele retenu pour `usage` : celui choisi dans le menu, sinon le modele par defaut. */
export function modelePour(usage) {
  return parId.get(lire.get(`model.${usage}`)?.value) || defaut;
}

/** `{ identify, chat }` : l'identifiant du modele de chaque usage. */
export function modelesChoisis() {
  return Object.fromEntries(USAGES.map((usage) => [usage, modelePour(usage).id]));
}

/**
 * Enregistre les choix `{ identify, chat }` (l'un ou l'autre suffit). Renvoie
 * le message d'erreur si un choix est invalide ; rien n'est alors enregistre.
 */
export function choisirModeles(choix) {
  const retenus = USAGES.filter((usage) => choix?.[usage] !== undefined);
  if (!retenus.length) return 'Aucun modele indique';
  const inconnu = retenus.find((usage) => !parId.has(choix[usage]));
  if (inconnu) return `Modele inconnu : ${String(choix[inconnu]).slice(0, 60)}`;
  db.transaction(() => {
    for (const usage of retenus) ecrire.run(`model.${usage}`, choix[usage]);
  })();
  return '';
}

/** La liste montree par l'interface. */
export function catalogue() {
  return MODELES.map(({ id, nom, prix }) => ({ id, name: nom, price: prix }));
}

/** Ce que la requete porte pour ce modele : son nom, et le repli s'il en a un. */
export function parametresModele(modele) {
  if (!modele.repli) return { model: modele.id };
  return {
    model: modele.id,
    // Si les garde-fous du modele declinent la demande, l'API la rejoue
    // d'elle-meme sur le modele de repli qu'Anthropic recommande.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

/** L'outil de recherche web, dans la version que ce modele connait. */
export function rechercheWeb(modele, options) {
  return { type: modele.recherche, name: 'web_search', ...options };
}
