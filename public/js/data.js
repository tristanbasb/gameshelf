/*
 * La collection, en memoire.
 *
 * L'interface charge la collection entiere une fois, puis filtre, trie et
 * cherche sur place : une frappe dans la recherche ne fait plus d'aller-retour
 * avec le serveur. Sur quelques centaines de fiches, filtrer prend moins
 * d'une milliseconde — l'affichage suit la frappe, sans etat de chargement
 * et sans que la page ne bouge.
 *
 * Une copie de la collection est gardee dans le navigateur. Elle s'affiche
 * avant meme la reponse du serveur, et elle permet de consulter et de
 * scanner en rayon, loin du Wi-Fi de la maison, la ou le serveur est
 * injoignable.
 */

import { api } from './api.js';
import { store } from './ui.js';
import { plateforme, comparerPlateformes } from './platforms.js';

/* -------------------------------------------------------------------------- */
/* Vocabulaire                                                                */
/* -------------------------------------------------------------------------- */

/** Etats, du meilleur au plus abime. '' = non renseigne. */
export const CONDITIONS = ['sealed', 'mint', 'good', 'fair', 'poor'];

export const CONDITION_LABELS = {
  sealed: 'Neuf, sous blister',
  mint: 'Très bon',
  good: 'Bon',
  fair: 'Acceptable',
  poor: 'Mauvais',
  '': 'Non renseigné',
};

export const CONDITION_SHORT = {
  sealed: 'Neuf',
  mint: 'Très bon',
  good: 'Bon',
  fair: 'Acceptable',
  poor: 'Mauvais',
  '': 'État ?',
};

/** Elements suivis dans un exemplaire, dans l'ordre ou on les verifie. */
export const PARTS = [
  { key: 'has_box', label: 'Boîte', missing: 'boîte' },
  { key: 'has_cover_art', label: 'Jaquette', missing: 'jaquette' },
  { key: 'has_manual', label: 'Notice', missing: 'notice' },
  { key: 'has_disc', label: 'Disque', missing: 'disque' },
];

export const missingParts = (game) => PARTS.filter((p) => !game[p.key]);
export const isComplete = (game) => PARTS.every((p) => game[p.key]);

/* -------------------------------------------------------------------------- */
/* Recherche                                                                  */
/* -------------------------------------------------------------------------- */

/** Forme comparable d'un texte : sans accents ni majuscules. */
export function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export const words = (query) => normalize(query).split(/[\s,]+/).filter(Boolean).slice(0, 10);

/*
 * Texte interroge par la recherche. Il contient aussi ce que la fiche dit
 * sans l'ecrire : le libelle de l'etat, et « sans notice » quand la notice
 * manque. « ps2 sans notice » liste donc ce qu'il reste a completer.
 */
function searchText(game) {
  const p = plateforme(game.platform);
  const manques = missingParts(game).map((part) => `sans ${part.missing}`);
  return normalize([
    game.title,
    game.platform,
    p.famille,
    game.region,
    game.serial,
    String(game.serial || '').replace(/[^a-z0-9]/gi, ''),
    game.ean,
    game.tags,
    game.notes,
    CONDITION_SHORT[game.condition] || '',
    manques.length ? `incomplet ${manques.join(' ')}` : 'complet',
    game.has_iso ? 'iso' : 'sans iso',
    game.favorite ? 'favori' : '',
  ].join(' '));
}

/** Pertinence d'une fiche pour des mots deja normalises : 0 = aucune. */
function relevance(entry, terms) {
  let score = 0;
  for (const term of terms) {
    if (!entry.text.includes(term)) return 0;
    if (entry.title.startsWith(term)) score += 4;
    else if (entry.title.includes(` ${term}`)) score += 3;
    else if (entry.title.includes(term)) score += 2;
    else score += 1;
  }
  return score;
}

/*
 * Surlignage. Le titre affiche garde ses accents, la recherche les ignore :
 * on fabrique la forme normalisee caractere par caractere, en retenant d'ou
 * vient chacun, pour retrouver les passages a marquer dans l'original.
 */
export function highlightRanges(text, terms) {
  if (!terms.length) return [];
  let flat = '';
  const origin = [];
  for (let i = 0; i < text.length; i += 1) {
    const n = normalize(text[i]);
    for (let k = 0; k < n.length; k += 1) {
      flat += n[k];
      origin.push(i);
    }
  }
  const marks = new Array(text.length).fill(false);
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = flat.indexOf(term, from);
      if (at === -1) break;
      for (let k = at; k < at + term.length; k += 1) marks[origin[k]] = true;
      from = at + term.length;
    }
  }
  const ranges = [];
  for (let i = 0; i < marks.length; i += 1) {
    if (!marks[i]) continue;
    const start = i;
    while (marks[i + 1]) i += 1;
    ranges.push([start, i + 1]);
  }
  return ranges;
}

/** Similarite grossiere entre deux textes normalises (bigrammes de Dice). */
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let common = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g);
    if (n) {
      grams.set(g, n - 1);
      common += 1;
    }
  }
  return (2 * common) / (a.length + b.length - 2);
}

/* -------------------------------------------------------------------------- */
/* Codes-barres                                                               */
/* -------------------------------------------------------------------------- */

/*
 * Une etiquette americaine porte douze chiffres (UPC-A), la meme referencee
 * en Europe en porte treize, le premier etant un zero : c'est le meme code.
 */
export function eanVariants(raw) {
  const ean = String(raw ?? '').replace(/[\s-]/g, '');
  const forms = new Set([ean]);
  if (ean.length === 13 && ean.startsWith('0')) forms.add(ean.slice(1));
  if (ean.length === 12) forms.add(`0${ean}`);
  return forms;
}

/* -------------------------------------------------------------------------- */
/* Etat de la collection                                                      */
/* -------------------------------------------------------------------------- */

const SNAPSHOT_KEY = 'gv-collection';

const listeners = new Set();

export const collection = {
  /** Fiches, par identifiant. */
  byId: new Map(),
  /** Index de recherche, par identifiant. */
  index: new Map(),
  /** La collection a-t-elle ete lue au moins une fois (serveur ou copie) ? */
  ready: false,
  /** La derniere lecture vient-elle du serveur, ou de la copie locale ? */
  live: false,
  /** Date de la copie affichee, quand elle ne vient pas du serveur. */
  savedAt: null,
};

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason) {
  for (const fn of listeners) fn(reason);
}

function indexGame(game) {
  collection.index.set(game.id, {
    text: searchText(game),
    title: normalize(game.title),
  });
}

function setAll(games) {
  collection.byId = new Map(games.map((g) => [g.id, g]));
  collection.index = new Map();
  for (const g of games) indexGame(g);
  collection.ready = true;
}

let lastPayload = '';

function saveSnapshot(payload) {
  store.set(SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), games: payload }));
}

/** Affiche tout de suite la derniere copie connue, s'il y en a une. */
export function loadSnapshot() {
  try {
    const raw = store.get(SNAPSHOT_KEY);
    if (!raw) return false;
    const { at, games } = JSON.parse(raw);
    if (!Array.isArray(games)) return false;
    setAll(games);
    lastPayload = JSON.stringify(games);
    collection.savedAt = at;
    emit('snapshot');
    return true;
  } catch {
    return false;
  }
}

/** Relit la collection sur le serveur ; ne repeint que si elle a change. */
export async function sync() {
  const { items } = await api.listGames({ limit: 'all', sort: 'title', dir: 'asc' });
  const payload = JSON.stringify(items);
  collection.live = true;
  collection.savedAt = null;
  if (payload === lastPayload && collection.ready) {
    emit('live');
    return false;
  }
  lastPayload = payload;
  setAll(items);
  saveSnapshot(items);
  emit('sync');
  return true;
}

/** Remplace une fiche apres une ecriture reussie. */
function put(game) {
  collection.byId.set(game.id, game);
  indexGame(game);
  persist();
}

function persist() {
  const games = [...collection.byId.values()];
  lastPayload = JSON.stringify(games);
  saveSnapshot(games);
}

/* -------------------------------------------------------------------------- */
/* Ecritures                                                                  */
/* -------------------------------------------------------------------------- */

export async function createGame(payload) {
  const game = await api.createGame(payload);
  put(game);
  emit('create');
  return game;
}

/**
 * Modification partielle, affichee avant la reponse du serveur. Si le
 * serveur refuse, la fiche reprend sa valeur d'avant et l'erreur remonte.
 */
export async function patchGame(id, changes) {
  const before = collection.byId.get(id);
  if (!before) throw new Error('Jeu introuvable');
  const optimistic = { ...before, ...changes };
  collection.byId.set(id, optimistic);
  indexGame(optimistic);
  emit('patch');
  try {
    const saved = await api.updateGame(id, changes);
    put(saved);
    emit('patch');
    return saved;
  } catch (err) {
    collection.byId.set(id, before);
    indexGame(before);
    emit('patch');
    throw err;
  }
}

export async function deleteGame(id) {
  await api.deleteGame(id);
  collection.byId.delete(id);
  collection.index.delete(id);
  persist();
  emit('delete');
}

/* -------------------------------------------------------------------------- */
/* Lecture                                                                    */
/* -------------------------------------------------------------------------- */

export const allGames = () => [...collection.byId.values()];
export const getGame = (id) => collection.byId.get(Number(id));

/** Filtres reconnus, avec leur valeur « inactive ». */
export const EMPTY_FILTERS = Object.freeze({
  q: '', platform: '', region: '', condition: '', tag: '',
  favorite: '', incomplete: '', iso: '',
});

const tagList = (game) => (game.tags ? game.tags.split(',').map((t) => t.trim()).filter(Boolean) : []);
export { tagList };

/**
 * Teste une fiche contre les filtres. `skip` ignore un filtre : c'est ce qui
 * permet de compter, pour chaque valeur d'un filtre, combien de jeux on
 * obtiendrait en la choisissant, compte tenu de tous les autres.
 */
function passes(game, filters, skip) {
  if (skip !== 'platform' && filters.platform && game.platform !== filters.platform) return false;
  if (skip !== 'region' && filters.region && game.region !== filters.region) return false;
  // « - » designe l'etat non renseigne : une valeur vide ne filtrerait rien.
  if (skip !== 'condition' && filters.condition
    && game.condition !== (filters.condition === '-' ? '' : filters.condition)) return false;
  if (skip !== 'tag' && filters.tag && !tagList(game).some((t) => t.toLowerCase() === filters.tag.toLowerCase())) return false;
  if (skip !== 'favorite' && filters.favorite === '1' && !game.favorite) return false;
  if (skip !== 'incomplete' && filters.incomplete === '1' && isComplete(game)) return false;
  if (skip !== 'iso' && filters.iso === '0' && game.has_iso) return false;
  if (skip !== 'iso' && filters.iso === '1' && !game.has_iso) return false;
  return true;
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

const CONDITION_RANK = { sealed: 0, mint: 1, good: 2, fair: 3, poor: 4, '': 5 };

export const SORTS = {
  title: { label: 'Titre', compare: (a, b) => collator.compare(a.title, b.title) },
  recent: {
    label: 'Ajout récent',
    compare: (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id,
  },
  platform: {
    label: 'Plateforme',
    compare: (a, b) => comparerPlateformes(a.platform, b.platform) || collator.compare(a.title, b.title),
  },
  condition: {
    label: 'État',
    compare: (a, b) => CONDITION_RANK[a.condition] - CONDITION_RANK[b.condition]
      || collator.compare(a.title, b.title),
  },
  updated: {
    label: 'Modifié récemment',
    compare: (a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id,
  },
};

/** Ordre de l'etagere : plateforme, puis titre. Celui de la frise. */
export const shelfOrder = (a, b) => SORTS.platform.compare(a, b);

/**
 * Applique filtres, recherche et tri. Renvoie la liste a afficher et, pour
 * chaque fiche retenue, de quoi surligner le titre.
 */
export function query(filters, sortKey = 'title') {
  const terms = words(filters.q);
  const sort = SORTS[sortKey] || SORTS.title;
  const results = [];

  for (const game of collection.byId.values()) {
    if (!passes(game, filters)) continue;
    let score = 0;
    if (terms.length) {
      score = relevance(collection.index.get(game.id), terms);
      if (!score) continue;
    }
    results.push({ game, score });
  }

  // Pendant une recherche, ce qui correspond par le titre passe devant ce
  // qui ne correspond que par une note ou un tag ; le tri choisi departage.
  results.sort((a, b) => {
    if (terms.length) {
      const tierA = a.score >= terms.length * 2 ? 0 : 1;
      const tierB = b.score >= terms.length * 2 ? 0 : 1;
      if (tierA !== tierB) return tierA - tierB;
    }
    return sort.compare(a.game, b.game);
  });

  return { games: results.map((r) => r.game), terms };
}

/** Le jeu correspond-il a la recherche et aux filtres ? (pour la frise) */
export function matcher(filters) {
  const terms = words(filters.q);
  return (game) => passes(game, filters)
    && (!terms.length || relevance(collection.index.get(game.id), terms) > 0);
}

/**
 * Compteurs de chaque valeur de filtre, calcules sur ce que donneraient les
 * autres filtres. Choisir « PS2 » annonce donc combien de jeux PS2 restent
 * avec la recherche en cours, pas combien la collection en contient.
 */
export function facets(filters) {
  const terms = words(filters.q);
  const pool = terms.length
    ? allGames().filter((g) => relevance(collection.index.get(g.id), terms) > 0)
    : allGames();

  const count = (skip, keyOf) => {
    const map = new Map();
    for (const g of pool) {
      if (!passes(g, filters, skip)) continue;
      for (const key of [].concat(keyOf(g))) {
        if (key === null || key === undefined) continue;
        map.set(key, (map.get(key) || 0) + 1);
      }
    }
    return map;
  };

  const platforms = count('platform', (g) => g.platform || null);
  const regions = count('region', (g) => g.region || null);
  const conditions = count('condition', (g) => g.condition);
  const tags = count('tag', (g) => tagList(g));

  const quick = {
    all: collection.byId.size,
    favorite: pool.filter((g) => g.favorite && passes(g, filters, 'favorite')).length,
    incomplete: pool.filter((g) => !isComplete(g) && passes(g, filters, 'incomplete')).length,
    noiso: pool.filter((g) => !g.has_iso && passes(g, filters, 'iso')).length,
  };

  return {
    platforms: [...platforms].sort((a, b) => comparerPlateformes(a[0], b[0])),
    regions: [...regions].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])),
    conditions,
    tags: [...tags].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])),
    quick,
  };
}

/** Toutes les valeurs connues d'un champ, de la plus frequente a la plus rare. */
export function knownValues(field) {
  const map = new Map();
  for (const g of collection.byId.values()) {
    const v = g[field];
    if (v) map.set(v, (map.get(v) || 0) + 1);
  }
  return [...map].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/** « Est-ce que je l'ai ? » — par code-barres, sans passer par le serveur. */
export function findByEan(code) {
  const forms = eanVariants(code);
  return allGames().filter((g) => g.ean && forms.has(g.ean));
}

/** Titres proches, pour « Vouliez-vous dire… » et l'alerte de doublon. */
export function similarTitles(text, { limit = 3, threshold = 0.5, exclude = null } = {}) {
  const target = normalize(text).trim();
  if (target.length < 3) return [];
  const scored = [];
  for (const g of collection.byId.values()) {
    if (g.id === exclude) continue;
    const s = similarity(target, collection.index.get(g.id).title);
    if (s >= threshold) scored.push([s, g]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, g]) => g);
}
