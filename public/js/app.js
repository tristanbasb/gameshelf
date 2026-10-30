/*
 * GameVault — demarrage et chef d'orchestre de l'interface.
 *
 * La collection vit en memoire (data.js) ; ce module tient les filtres, les
 * reflete dans l'adresse, et redessine ce qui doit l'etre a chaque geste.
 */

import { api } from './api.js';
import { $, store, toast, openSheet, esc, icon, debounce } from './ui.js';
import {
  collection, loadSnapshot, sync, onChange, query, matcher, facets,
  EMPTY_FILTERS, SORTS, similarTitles, words, getGame, allGames,
} from './data.js';
import {
  renderResults, renderTally, createStrip, filtersMarkup, chipsMarkup,
  activeFilterCount, emptyMarkup, handleBrokenImage, prune, thumbUrl,
} from './views.js';
import { actions } from './actions.js';
import { openDetail } from './detail.js';
import { openEditor } from './editor.js';
import { openScanner } from './scanner.js';
import { openIdentify } from './identify.js';
import { openChat } from './chat.js';
import { openStats } from './stats.js';
import { openMenu, openTransfer } from './menu.js';

/* -------------------------------------------------------------------------- */
/* Etat                                                                       */
/* -------------------------------------------------------------------------- */

const VIEWS = [
  { key: 'covers', label: 'Jaquettes', icon: 'covers' },
  { key: 'shelf', label: 'Étagère', icon: 'shelf' },
  { key: 'list', label: 'Liste', icon: 'list' },
];

const state = {
  filters: { ...EMPTY_FILTERS },
  sort: SORTS[store.get('gv-sort')] ? store.get('gv-sort') : 'title',
  view: VIEWS.some((v) => v.key === store.get('gv-view')) ? store.get('gv-view') : 'covers',
};

const el = {
  q: $('#q'),
  qClear: $('#q-clear'),
  results: $('#results'),
  count: $('#tally-count'),
  sub: $('#tally-sub'),
  chips: $('#chips'),
  filters: $('#filters'),
  badge: $('#filters-badge'),
  sort: $('#sort'),
  views: $('#views'),
  net: $('#net'),
  topbar: $('.topbar'),
};

/* -------------------------------------------------------------------------- */
/* Adresse                                                                    */
/* -------------------------------------------------------------------------- */

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  for (const key of Object.keys(EMPTY_FILTERS)) {
    state.filters[key] = params.get(key) ?? '';
  }
  // Ancienne adresse de la recherche, gardee pour les favoris existants.
  if (!state.filters.q && params.get('search')) state.filters.q = params.get('search');
  if (SORTS[params.get('sort')]) state.sort = params.get('sort');
  return params;
}

function writeUrlNow() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) {
    if (value) params.set(key, value);
  }
  const search = params.toString();
  try {
    // L'etat de l'historique est conserve : il porte les fenetres ouvertes.
    history.replaceState(history.state, '', search ? `/?${search}` : '/');
  } catch {
    /* adresse non modifiable : simple confort perdu */
  }
}

const writeUrl = debounce(writeUrlNow, 300);

/* -------------------------------------------------------------------------- */
/* Rendu                                                                      */
/* -------------------------------------------------------------------------- */

const strip = createStrip($('#strip'), $('#strip-bubble'), { onOpen: (id) => openDetail(id) });
let filterSheet = null;
let lastTerms = '';

function isFiltered() {
  return Object.values(state.filters).some(Boolean);
}

function render() {
  if (!collection.ready) return;

  const { games, terms } = query(state.filters, state.sort);
  const total = collection.byId.size;

  if (games.length) {
    renderResults(el.results, games, terms, state.view);
  } else {
    el.results.innerHTML = emptyMarkup({
      hasCollection: total > 0,
      query: state.filters.q.trim(),
      suggestions: state.filters.q.trim() ? similarTitles(state.filters.q, { threshold: 0.35 }) : [],
    });
  }

  renderTally(el.count, el.sub, games, total, isFiltered());
  el.chips.innerHTML = chipsMarkup(state.filters);

  // Le panneau est redessine : au clavier, le focus reste sur le filtre
  // que l'on vient d'actionner.
  const focused = document.activeElement?.closest?.('[data-facet]');
  const focusKey = focused ? `[data-facet="${focused.dataset.facet}"][data-value="${CSS.escape(focused.dataset.value)}"]` : null;
  const focusHost = focused?.closest('dialog') ? filterSheet?.el : el.filters;

  const f = facets(state.filters);
  const panel = filtersMarkup(state.filters, f);
  el.filters.innerHTML = panel;
  if (filterSheet) filterSheet.$('.sheet-body').innerHTML = panel;
  if (focusKey) focusHost?.querySelector(focusKey)?.focus({ preventScroll: true });

  const n = activeFilterCount(state.filters);
  el.badge.hidden = n === 0;
  el.badge.textContent = String(n);

  strip.update(matcher(state.filters), isFiltered());

  el.qClear.hidden = !el.q.value;
  writeUrl();
}

let frame = 0;
function scheduleRender() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(render);
}

/*
 * Apres un changement de recherche ou de filtre, si l'on avait defile loin
 * dans la collection, on revient au debut des resultats — sous l'en-tete, qui
 * lui ne bouge pas. Sans cela, la page raccourcie laisserait la vue a un
 * endroit quelconque.
 */
function revealResults() {
  const top = el.results.getBoundingClientRect().top + window.scrollY - el.topbar.offsetHeight - 12;
  if (window.scrollY > top) window.scrollTo({ top: Math.max(top, 0), behavior: 'instant' });
}

function setFilters(changes, { replace = false } = {}) {
  state.filters = replace ? { ...EMPTY_FILTERS, ...changes } : { ...state.filters, ...changes };
  if ('q' in changes && el.q.value !== state.filters.q) el.q.value = state.filters.q;
  render();
  revealResults();
}

/* -------------------------------------------------------------------------- */
/* Controles                                                                  */
/* -------------------------------------------------------------------------- */

function renderControls() {
  el.sort.innerHTML = Object.entries(SORTS)
    .map(([key, s]) => `<option value="${key}"${key === state.sort ? ' selected' : ''}>${esc(s.label)}</option>`)
    .join('');
  el.views.innerHTML = VIEWS.map((v) => `
    <button type="button" role="radio" data-view="${v.key}" aria-checked="${v.key === state.view}"
      title="${esc(v.label)}" aria-label="${esc(v.label)}">${icon(v.icon)}</button>`).join('');
}

function setView(view) {
  state.view = view;
  store.set('gv-view', view);
  for (const button of el.views.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-checked', String(button.dataset.view === view));
  }
  render();
}

function toggleFacet(key, value) {
  if (key === 'all') {
    el.q.value = '';
    setFilters({}, { replace: true });
    return;
  }
  setFilters({ [key]: state.filters[key] === value ? '' : value });
}

function openFilterSheet() {
  const f = facets(state.filters);
  filterSheet = openSheet({
    className: 'sheet--filters',
    label: 'Filtres',
    content: `<div class="sheet-wrap">
      <div class="sheet-head"><h2 class="sheet-title">Filtres</h2>
        <button type="button" class="icon-btn" data-close aria-label="Fermer">${icon('close')}</button></div>
      <div class="sheet-body">${filtersMarkup(state.filters, f)}</div>
      <div class="sheet-foot">
        <button type="button" class="btn btn--ghost" data-sheet-reset>Tout effacer</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn--primary" data-close data-sheet-count></button>
      </div></div>`,
    onClose: () => {
      filterSheet = null;
    },
  });
  const updateCount = () => {
    const n = query(state.filters, state.sort).games.length;
    filterSheet.$('[data-sheet-count]').textContent = `Voir ${n} jeu${n > 1 ? 'x' : ''}`;
  };
  updateCount();
  filterSheet.el.addEventListener('click', (event) => {
    const facet = event.target.closest('[data-facet]');
    if (facet) {
      toggleFacet(facet.dataset.facet, facet.dataset.value);
      updateCount();
    } else if (event.target.closest('[data-sheet-reset]')) {
      setFilters({ q: state.filters.q }, { replace: true });
      updateCount();
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Evenements                                                                 */
/* -------------------------------------------------------------------------- */

function bindEvents() {
  el.q.addEventListener('input', () => {
    state.filters.q = el.q.value;
    const terms = words(el.q.value).join(' ');
    el.qClear.hidden = !el.q.value;
    if (terms === lastTerms) return;
    lastTerms = terms;
    scheduleRender();
    requestAnimationFrame(revealResults);
  });
  el.q.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      // Ferme le clavier du telephone pour laisser voir les resultats.
      event.preventDefault();
      el.q.blur();
    } else if (event.key === 'Escape' && el.q.value) {
      event.preventDefault();
      el.q.value = '';
      setFilters({ q: '' });
    }
  });
  el.qClear.addEventListener('click', () => {
    el.q.value = '';
    setFilters({ q: '' });
    el.q.focus({ preventScroll: true });
  });

  el.sort.addEventListener('change', () => {
    state.sort = el.sort.value;
    store.set('gv-sort', state.sort);
    render();
  });
  el.views.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button) setView(button.dataset.view);
  });

  el.filters.addEventListener('click', (event) => {
    const facet = event.target.closest('[data-facet]');
    if (facet) toggleFacet(facet.dataset.facet, facet.dataset.value);
  });
  el.chips.addEventListener('click', (event) => {
    const clear = event.target.closest('[data-clear]');
    if (clear) setFilters({ [clear.dataset.clear]: '' });
  });

  el.results.addEventListener('error', handleBrokenImage, true);
  el.results.addEventListener('click', (event) => {
    const item = event.target.closest('[data-id]');
    if (item) {
      openDetail(Number(item.dataset.id));
      return;
    }
    const suggestion = event.target.closest('[data-suggest]');
    if (suggestion) setFilters({ q: suggestion.dataset.suggest });
  });

  // Actions nommees, ou qu'elles se trouvent (en-tete, barre du bas, vide).
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    const action = trigger.dataset.action;
    if (action === 'home') {
      event.preventDefault();
      el.q.value = '';
      setFilters({}, { replace: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else if (action === 'scan') openScanner();
    else if (action === 'add') openEditor();
    else if (action === 'add-title') openEditor(null, { title: state.filters.q.trim() });
    else if (action === 'stats') openStats();
    else if (action === 'menu') openMenu();
    else if (action === 'chat') openChat();
    else if (action === 'io') openTransfer();
    else if (action === 'filters') openFilterSheet();
    else if (action === 'reset') {
      el.q.value = '';
      setFilters({}, { replace: true });
    } else if (action === 'reset-filters') setFilters({ q: state.filters.q }, { replace: true });
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      el.q.focus();
      el.q.select();
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '/') {
      event.preventDefault();
      el.q.focus();
    } else if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      openScanner();
    } else if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      openEditor();
    } else if ((event.key === 'c' || event.key === 'C') && actions.instance.chat) {
      event.preventDefault();
      openChat();
    }
  });

  // Hauteur reelle de l'en-tete : la colonne de filtres s'y cale.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--topbar-h', `${el.topbar.offsetHeight}px`);
  }).observe(el.topbar);
}

/* -------------------------------------------------------------------------- */
/* Synchronisation                                                            */
/* -------------------------------------------------------------------------- */

let lastSync = 0;

function showNetwork(stateName) {
  if (stateName === 'live') {
    el.net.hidden = true;
    return;
  }
  el.net.hidden = false;
  el.net.dataset.tone = stateName === 'offline' ? 'offline' : 'saved';
  el.net.innerHTML = `${icon('offline', { size: 14 })}${stateName === 'offline' ? 'Hors ligne' : 'Copie locale'}`;
  el.net.title = collection.savedAt
    ? `Collection enregistrée sur cet appareil le ${new Date(collection.savedAt).toLocaleString('fr-FR')}. Consultation et scan disponibles ; modifications impossibles.`
    : 'Serveur injoignable.';
}

async function refreshFromServer({ quiet = false } = {}) {
  lastSync = Date.now();
  try {
    await sync();
    showNetwork('live');
    keepThumbsOffline();
  } catch (err) {
    if (collection.ready) {
      showNetwork(navigator.onLine === false ? 'offline' : 'saved');
      if (!quiet) toast('Serveur injoignable : affichage de la copie enregistrée sur cet appareil.');
    } else {
      showNetwork('offline');
      el.results.innerHTML = `<div class="empty">
        <p class="empty-title">Collection injoignable</p>
        <p>${esc(err.message)}. Vérifiez que l’appareil est sur le même réseau que le serveur.</p>
        <div class="empty-actions"><button type="button" class="btn btn--primary" data-retry>Réessayer</button></div></div>`;
      el.results.querySelector('[data-retry]')?.addEventListener('click', () => refreshFromServer());
    }
  }
}

onChange((reason) => {
  if (['snapshot', 'sync', 'create', 'delete'].includes(reason)) {
    strip.build();
    prune();
  }
  if (reason === 'patch') {
    // Un changement de plateforme ou de titre deplace la tranche dans la frise.
    strip.build();
  }
  scheduleRender();
});

document.addEventListener('visibilitychange', () => {
  // De retour sur l'onglet : on recupere ce qui a pu changer ailleurs (le
  // telephone a ajoute un jeu pendant qu'on etait sur l'ordinateur).
  if (document.visibilityState === 'visible' && Date.now() - lastSync > 20000) {
    refreshFromServer({ quiet: true });
  }
});
window.addEventListener('online', () => refreshFromServer({ quiet: true }));
// Page restauree depuis le cache du navigateur (bouton precedent) : elle
// peut dater, on la remet a jour.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) refreshFromServer({ quiet: true });
});
window.addEventListener('offline', () => showNetwork('offline'));

/* -------------------------------------------------------------------------- */
/* Hors ligne                                                                 */
/* -------------------------------------------------------------------------- */

/*
 * Le service worker garde l'interface pour l'ouvrir sans reseau. Il n'est
 * accepte que sur une connexion securisee dont le certificat est reconnu :
 * avec le certificat local simplement « accepte », le navigateur le refuse,
 * et l'application fonctionne comme avant.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const version = new URL(import.meta.url).pathname.match(/^\/a\/([0-9a-f]{10})\//)?.[1] || '';
  navigator.serviceWorker.register('/sw.js').then((registration) => {
    const send = (worker) => worker?.postMessage({ type: 'version', version });
    send(registration.active);
    navigator.serviceWorker.ready.then((ready) => send(ready.active));
  }).catch(() => {
    /* refuse (certificat non reconnu, navigation privee) : sans consequence */
  });
}

/*
 * Les miniatures de toute la collection partent dans le service worker, et
 * pas seulement celles que la grille a deja affichees : en magasin, le jeu
 * que l'on scanne doit avoir sa jaquette. La liste n'est renvoyee que si
 * elle a change — une miniature que le serveur n'a pas pu fabriquer n'est
 * pas redemandee a chaque retour sur l'onglet.
 */
let sentThumbs = '';

function keepThumbsOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const urls = [...new Set(allGames().map((g) => g.cover_url).filter(Boolean))].sort().map(thumbUrl);
  const list = urls.join('\n');
  if (list === sentThumbs) return;
  sentThumbs = list;
  // Apres l'affichage : les images visibles passent avant.
  setTimeout(() => {
    navigator.serviceWorker.ready.then((ready) => ready.active?.postMessage({ type: 'thumbs', urls }));
  }, 3000);
}

/* -------------------------------------------------------------------------- */
/* Demarrage                                                                  */
/* -------------------------------------------------------------------------- */

Object.assign(actions, {
  openDetail,
  openEditor,
  openScanner,
  openStats,
  openMenu,
  openTransfer,
  openFilters: openFilterSheet,
  openIdentify,
  openChat,
  showOnly: (filters) => {
    el.q.value = filters.q || '';
    setFilters(filters, { replace: true });
  },
});

async function init() {
  const params = readUrl();
  // Les raccourcis (?action=scan, ?id=…) ne servent qu'une fois : l'adresse
  // n'en garde que les filtres, pour qu'un rechargement ne les rejoue pas.
  writeUrlNow();
  el.q.value = state.filters.q;
  lastTerms = words(state.filters.q).join(' ');
  renderControls();
  bindEvents();

  // La copie locale s'affiche tout de suite ; le serveur confirme ensuite.
  loadSnapshot();
  api.config().then((config) => {
    Object.assign(actions.instance, config);
    // Le bouton de l'en-tete n'apparait qu'avec une cle Anthropic.
    for (const button of document.querySelectorAll('[data-needs-claude]')) button.hidden = !config.chat;
  }).catch(() => {});
  await refreshFromServer({ quiet: true });

  // Raccourcis de l'ecran d'accueil du telephone.
  if (params.get('action') === 'scan') openScanner();
  else if (params.get('action') === 'add') openEditor();
  const id = Number(params.get('id'));
  if (id && getGame(id)) openDetail(id);

  registerServiceWorker();
}

init();
