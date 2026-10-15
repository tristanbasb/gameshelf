/*
 * Rendu de la collection : jaquettes, etagere, liste, et la frise.
 *
 * Chaque fiche est fabriquee une fois puis reutilisee : filtrer ne fait que
 * retirer et remettre des elements deja construits, avec leurs images deja
 * chargees. Rien ne clignote, rien ne se recharge pendant la frappe.
 */

import { esc, icon, marked, fmtNumber, plural } from './ui.js';
import { plateforme, comparerPlateformes } from './platforms.js';
import {
  CONDITION_SHORT, CONDITION_LABELS, CONDITIONS, PARTS, missingParts,
  highlightRanges, shelfOrder, allGames, getGame, knownValues, EMPTY_FILTERS,
} from './data.js';

/* -------------------------------------------------------------------------- */
/* Pieces communes                                                            */
/* -------------------------------------------------------------------------- */

export const spineVars = (p) =>
  `--sb:${p.fond};--si:${p.encre};--bb:${p.bandeau};--bi:${p.encreBandeau}`;

export const condVar = (condition) => `--cc:var(--c-${condition || 'none'})`;

/** Taille du boitier dans une case 3:4, d'apres le format de sa face. */
function caseSize(format) {
  const stage = 3 / 4;
  return format <= stage
    ? `--cw:${((format / stage) * 100).toFixed(2)}%;--ch:100%`
    : `--cw:100%;--ch:${((stage / format) * 100).toFixed(2)}%`;
}

/** Les images qui ont deja echoue ne sont plus redemandees. */
const brokenImages = new Set();

/**
 * Le boitier d'un jeu : sa jaquette, ou, faute d'image, une face fabriquee
 * aux couleurs de la plateforme — bandeau, titre, serial.
 */
export function caseMarkup(game, { sized = true, eager = false, extra = '' } = {}) {
  const p = plateforme(game.platform);
  const size = sized ? caseSize(p.format) : `--fmt:${p.format}`;
  const band = [p.court !== '—' ? p.court : '', game.region].filter(Boolean).join(' · ');
  if (game.cover_url && !brokenImages.has(game.cover_url)) {
    return `<span class="case" style="${size};${spineVars(p)}" data-band="${esc(band)}">
      <img src="${esc(game.cover_url)}" alt="" ${eager ? '' : 'loading="lazy"'} decoding="async"
        referrerpolicy="no-referrer" draggable="false">${extra}</span>`;
  }
  return `<span class="case case--made" style="${size};${spineVars(p)}" data-band="${esc(band)}">
    <span class="made-title">${esc(game.title)}</span>
    ${game.serial ? `<span class="made-serial">${esc(game.serial)}</span>` : ''}${extra}</span>`;
}

/**
 * Remplace une image cassee par la face fabriquee. L'evenement `error` ne
 * remonte pas : il est ecoute en capture, sur le conteneur.
 */
export function handleBrokenImage(event) {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  const box = img.closest('.case');
  const host = img.closest('[data-id]');
  if (!box || !host) {
    // Vignette de liste, halo de la fiche : on retire simplement l'image.
    img.remove();
    return;
  }
  const game = getGame(host.dataset.id);
  if (!game) return;
  brokenImages.add(game.cover_url);
  const badges = box.querySelector('.case-badges')?.outerHTML || '';
  box.classList.add('case--made');
  box.innerHTML = `<span class="made-title">${esc(game.title)}</span>
    ${game.serial ? `<span class="made-serial">${esc(game.serial)}</span>` : ''}${badges}`;
}

/** Les quatre elements de l'exemplaire, en pastilles. */
export function pips(game) {
  return `<span class="pips" title="${esc(partsSummary(game))}">${PARTS
    .map((part) => `<i class="${game[part.key] ? '' : 'off'}"></i>`).join('')}</span>`;
}

export function partsSummary(game) {
  const missing = missingParts(game);
  return missing.length ? `Sans ${missing.map((p) => p.missing).join(', ')}` : 'Complet';
}

const platformLine = (game) => [game.platform, game.region].filter(Boolean).join(' · ');

/** Signature d'une fiche : ce qui, s'il change, oblige a la redessiner. */
const signature = (g) => [
  g.title, g.platform, g.region, g.condition, g.quantity, g.favorite, g.cover_url, g.serial,
  g.has_box, g.has_cover_art, g.has_manual, g.has_disc, g.has_iso,
].join('\u0001');

/* -------------------------------------------------------------------------- */
/* Jaquettes                                                                  */
/* -------------------------------------------------------------------------- */

function cardBadges(game) {
  const missing = missingParts(game).length;
  const left = [
    game.quantity > 1 ? `<span class="badge" title="${game.quantity} exemplaires">×${game.quantity}</span>` : '',
    missing ? `<span class="badge badge--parts" title="${esc(partsSummary(game))}">${PARTS.length - missing}/${PARTS.length}</span>` : '',
  ].join('');
  const right = game.favorite ? `<span class="badge badge--fav" title="Favori">${icon('star', { size: 12, fill: true })}</span>` : '';
  return left || right ? `<span class="case-badges"><span>${left}</span><span>${right}</span></span>` : '';
}

function buildCard(game) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'card';
  el.dataset.id = game.id;
  el.innerHTML = `
    <span class="card-stage">${caseMarkup(game, { extra: cardBadges(game) })}</span>
    <span class="card-title"></span>
    <span class="card-meta"><span class="dot" style="${condVar(game.condition)}"></span>${esc(platformLine(game) || CONDITION_SHORT[game.condition])}</span>`;
  el.setAttribute('aria-label', `${game.title}${game.platform ? `, ${game.platform}` : ''}`);
  return el;
}

/* -------------------------------------------------------------------------- */
/* Liste                                                                      */
/* -------------------------------------------------------------------------- */

function buildRow(game) {
  const p = plateforme(game.platform);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'row';
  el.dataset.id = game.id;
  const thumb = game.cover_url && !brokenImages.has(game.cover_url)
    ? `<img src="${esc(game.cover_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
  el.innerHTML = `
    <span class="row-thumb" style="${spineVars(p)}">${thumb}</span>
    <span class="row-title"><strong></strong><span>${esc(platformLine(game))}</span></span>
    <span class="row-cell">${esc(game.platform || '—')}</span>
    <span class="row-cell">${esc(game.region || '—')}</span>
    <span class="row-cell row-cond"><span class="dot" style="${condVar(game.condition)}"></span>${esc(CONDITION_SHORT[game.condition])}</span>
    <span class="row-cell row-keep">${pips(game)}</span>
    <span class="row-cell mono">${esc(game.serial || '—')}</span>`;
  return el;
}

/* -------------------------------------------------------------------------- */
/* Etagere                                                                    */
/* -------------------------------------------------------------------------- */

function buildSpine(game) {
  const p = plateforme(game.platform);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'spine';
  el.dataset.id = game.id;
  el.style.cssText = `--t:${p.epaisseur};--hh:${p.hauteur};${spineVars(p)}`;
  el.title = `${game.title}${game.platform ? ` — ${platformLine(game)}` : ''}`;
  el.innerHTML = `
    <span class="spine-band">${esc(p.court === '—' ? '' : p.court)}</span>
    <span class="spine-title"></span>
    ${game.favorite ? '<span class="spine-fav"></span>' : ''}
    <span class="spine-foot">${esc(game.region)}</span>`;
  return el;
}

const metres = (mm) => `${(mm / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;

/** Longueur d'etagere occupee, en millimetres. */
export const shelfLength = (games) => games.reduce((sum, g) => sum + plateforme(g.platform).epaisseur, 0);
export const fmtShelf = (games) => metres(shelfLength(games));

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                             */
/* -------------------------------------------------------------------------- */

const BUILDERS = { covers: buildCard, list: buildRow, shelf: buildSpine };
const pools = { covers: new Map(), list: new Map(), shelf: new Map() };

function element(view, game) {
  const pool = pools[view];
  const sig = signature(game);
  let entry = pool.get(game.id);
  if (!entry || entry.sig !== sig) {
    entry = { el: BUILDERS[view](game), sig, marked: null };
    pool.set(game.id, entry);
  }
  return entry;
}

function setTitle(entry, game, terms) {
  const key = terms.join(' ');
  if (entry.marked === key) return;
  entry.marked = key;
  const target = entry.el.querySelector('.card-title, .row-title strong, .spine-title');
  target.innerHTML = marked(game.title, highlightRanges(game.title, terms));
}

/** Oublie les fiches supprimees, pour ne pas les garder en memoire. */
export function prune() {
  for (const pool of Object.values(pools)) {
    for (const id of pool.keys()) if (!getGame(id)) pool.delete(id);
  }
}

let currentView = null;

/** Affiche `games` dans `container`, selon la vue choisie. */
export function renderResults(container, games, terms, view) {
  if (currentView !== view) {
    container.replaceChildren();
    currentView = view;
  }

  if (view === 'shelf') {
    renderShelves(container, games, terms);
    return;
  }

  let host = container.firstElementChild;
  const cls = view === 'list' ? 'rows' : 'covers';
  if (!host || !host.classList.contains(cls)) {
    host = document.createElement('div');
    host.className = cls;
    container.replaceChildren(host);
  }

  const nodes = games.map((game) => {
    const entry = element(view, game);
    setTitle(entry, game, terms);
    return entry.el;
  });
  if (view === 'list') {
    nodes.unshift(rowsHead());
  }
  host.replaceChildren(...nodes);
}

let head = null;
function rowsHead() {
  head ??= Object.assign(document.createElement('div'), {
    className: 'rows-head',
    innerHTML: '<span></span><span>Titre</span><span>Plateforme</span><span>Région</span><span>État</span><span>Contenu</span><span>Serial</span>',
  });
  head.setAttribute('aria-hidden', 'true');
  return head;
}

function renderShelves(container, games, terms) {
  // Une etagere par plateforme, rangees dans l'ordre des familles.
  const groups = new Map();
  for (const game of games) {
    const key = game.platform || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(game);
  }
  const ordered = [...groups].sort((a, b) => comparerPlateformes(a[0], b[0]));

  const wrap = document.createElement('div');
  wrap.className = 'shelves';
  for (const [name, list] of ordered) {
    const section = document.createElement('section');
    section.className = 'shelf-group';
    section.innerHTML = `<header class="shelf-head">
        <h2 class="shelf-name">${esc(name || 'Sans plateforme')}</h2>
        <span class="shelf-facts">${plural(list.length, 'jeu', 'jeux')} · ${fmtShelf(list)}</span>
      </header>`;
    const shelf = document.createElement('div');
    shelf.className = 'shelf';
    // Chaque meuble a la hauteur de son plus grand boitier : une etagere de
    // jeux PS1 n'a pas a reserver la place d'un boitier DVD.
    shelf.style.setProperty('--maxh', Math.max(...list.map((g) => plateforme(g.platform).hauteur)));
    shelf.append(...list.map((game) => {
      const entry = element('shelf', game);
      setTitle(entry, game, terms);
      return entry.el;
    }));
    section.appendChild(shelf);
    wrap.appendChild(section);
  }
  container.replaceChildren(wrap);
}

/* -------------------------------------------------------------------------- */
/* Etat vide                                                                  */
/* -------------------------------------------------------------------------- */

export function emptyMarkup({ hasCollection, query, suggestions }) {
  if (!hasCollection) {
    return `<div class="empty">
      <p class="empty-title">Votre étagère est vide</p>
      <p>Ajoutez un premier jeu, ou importez un inventaire existant en CSV ou JSON.</p>
      <div class="empty-actions">
        <button type="button" class="btn btn--primary" data-action="add">${icon('plus')}Ajouter un jeu</button>
        <button type="button" class="btn" data-action="io">${icon('transfer')}Importer un fichier</button>
      </div></div>`;
  }
  return `<div class="empty">
    <p class="empty-title">${query ? `Rien pour « ${esc(query)} »` : 'Aucun jeu ne correspond'}</p>
    <p>${query ? 'Vérifiez l’orthographe, ou cherchez par serial ou code-barres.' : 'Retirez un filtre pour élargir la sélection.'}</p>
    ${suggestions.length ? `<div class="suggest" aria-label="Titres proches">${suggestions
      .map((g) => `<button type="button" data-suggest="${esc(g.title)}">${esc(g.title)}</button>`).join('')}</div>` : ''}
    <div class="empty-actions">
      <button type="button" class="btn" data-action="reset">Tout effacer</button>
      ${query ? `<button type="button" class="btn btn--ghost" data-action="add-title">${icon('plus')}Ajouter « ${esc(query)} »</button>` : ''}
    </div></div>`;
}

/* -------------------------------------------------------------------------- */
/* Compteur                                                                   */
/* -------------------------------------------------------------------------- */

export function renderTally(countEl, subEl, games, total, filtered) {
  const copies = games.reduce((n, g) => n + (Number(g.quantity) || 1), 0);
  countEl.innerHTML = filtered
    ? `${fmtNumber(games.length)} <small>${games.length > 1 ? 'jeux' : 'jeu'} sur ${fmtNumber(total)}</small>`
    : `${fmtNumber(games.length)} <small>${games.length > 1 ? 'jeux' : 'jeu'}</small>`;
  subEl.textContent = games.length
    ? [copies !== games.length ? plural(copies, 'exemplaire') : '', `${fmtShelf(games)} d’étagère`]
      .filter(Boolean).join(' · ')
    : '';
}

/* -------------------------------------------------------------------------- */
/* Frise                                                                      */
/* -------------------------------------------------------------------------- */

export function createStrip(stripEl, bubbleEl, { onOpen }) {
  let slices = [];
  let byId = new Map();
  let bounds = null;
  let current = null;
  let gesture = null;

  function build() {
    const games = allGames().sort(shelfOrder);
    slices = games.map((game) => {
      const el = document.createElement('i');
      const p = plateforme(game.platform);
      el.style.cssText = `--t:${p.epaisseur};--c:${p.trait}`;
      return { id: game.id, el };
    });
    byId = new Map(slices.map((s) => [s.id, s]));
    stripEl.replaceChildren(...slices.map((s) => s.el));
  }

  function update(test, filtering) {
    stripEl.classList.toggle('is-filtering', filtering);
    if (!filtering) return;
    for (const slice of slices) {
      const game = getGame(slice.id);
      slice.el.classList.toggle('on', Boolean(game && test(game)));
    }
  }

  function measure() {
    bounds = slices.map((s) => {
      const r = s.el.getBoundingClientRect();
      return [r.left, r.right];
    });
  }

  function at(x) {
    if (!bounds || !bounds.length) return null;
    let lo = 0;
    let hi = bounds.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bounds[mid][1] < x) lo = mid + 1;
      else hi = mid;
    }
    return slices[lo];
  }

  function show(slice, x) {
    if (current && current !== slice) current.el.classList.remove('is-current');
    current = slice;
    if (!slice) {
      bubbleEl.hidden = true;
      return;
    }
    slice.el.classList.add('is-current');
    const game = getGame(slice.id);
    if (!game) return;
    const p = plateforme(game.platform);
    bubbleEl.innerHTML = `${game.cover_url && !brokenImages.has(game.cover_url)
      ? `<img src="${esc(game.cover_url)}" alt="" referrerpolicy="no-referrer">`
      : `<span class="bubble-swatch" style="background:${p.trait}"></span>`}
      <div><strong>${esc(game.title)}</strong><span>${esc(platformLine(game))}</span></div>`;
    bubbleEl.hidden = false;
    const zone = bubbleEl.parentElement.getBoundingClientRect();
    const width = bubbleEl.offsetWidth;
    const left = Math.min(Math.max(x - zone.left - width / 2, 8), zone.width - width - 8);
    bubbleEl.style.left = `${left}px`;
  }

  function hide() {
    show(null);
  }

  bubbleEl.addEventListener('error', (event) => event.target.remove?.(), true);
  stripEl.addEventListener('pointerenter', measure);
  stripEl.addEventListener('pointermove', (event) => {
    if (!bounds) measure();
    if (gesture) {
      gesture.moved = gesture.moved || Math.abs(event.clientX - gesture.x) > 4;
      // Le doigt s'est franchement eloigne de la frise : on abandonne.
      gesture.away = Math.abs(event.clientY - gesture.y) > 70;
      if (gesture.away) {
        hide();
        return;
      }
    } else if (event.pointerType !== 'mouse') {
      return;
    }
    show(at(event.clientX), event.clientX);
  });
  stripEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    measure();
    gesture = { x: event.clientX, y: event.clientY, moved: false, away: false };
    try {
      stripEl.setPointerCapture(event.pointerId);
    } catch {
      /* capture refusee : le geste fonctionne quand meme sans glisser */
    }
    show(at(event.clientX), event.clientX);
  });
  stripEl.addEventListener('pointerup', (event) => {
    const g = gesture;
    gesture = null;
    const slice = g && !g.away ? at(event.clientX) : null;
    if (event.pointerType !== 'mouse') hide();
    if (slice) onOpen(slice.id);
  });
  stripEl.addEventListener('pointercancel', () => {
    gesture = null;
    hide();
  });
  stripEl.addEventListener('pointerleave', () => {
    if (!gesture) hide();
  });
  window.addEventListener('resize', () => {
    bounds = null;
  });

  return { build, update, has: (id) => byId.has(id) };
}

/* -------------------------------------------------------------------------- */
/* Filtres                                                                    */
/* -------------------------------------------------------------------------- */

const facetButton = ({ key, value, label, count, active, lead = '' }) => `
  <button type="button" class="facet${!count && !active ? ' is-empty' : ''}" data-facet="${key}"
    data-value="${esc(value)}" aria-pressed="${active}">
    ${lead}<span class="facet-label">${esc(label)}</span>
    <span class="facet-count">${fmtNumber(count)}</span>
  </button>`;

export function filtersMarkup(filters, f) {
  const quick = `
    <section class="facet-group">
      <h2 class="facet-title">Collection</h2>
      <button type="button" class="facet" data-facet="all" data-value="" aria-pressed="${!Object.entries(filters).some(([k, v]) => v && k !== 'q')}">
        ${icon('home', { size: 16 })}<span class="facet-label">Tous les jeux</span>
        <span class="facet-count">${fmtNumber(f.quick.all)}</span>
      </button>
      ${facetButton({ key: 'favorite', value: '1', label: 'Favoris', count: f.quick.favorite, active: filters.favorite === '1', lead: icon('star', { size: 16 }) })}
      ${facetButton({ key: 'incomplete', value: '1', label: 'Incomplets', count: f.quick.incomplete, active: filters.incomplete === '1', lead: icon('box', { size: 16 }) })}
      ${facetButton({ key: 'iso', value: '0', label: 'Sans ISO', count: f.quick.noiso, active: filters.iso === '0', lead: icon('disc', { size: 16 }) })}
    </section>`;

  // Toutes les plateformes de la collection restent listees, meme celles
  // qu'aucun jeu ne satisfait avec les filtres en cours : la liste ne
  // change pas de forme sous le doigt.
  const counts = new Map(f.platforms);
  const names = knownValues('platform').sort(comparerPlateformes);
  const families = new Map();
  for (const name of names) {
    const fam = plateforme(name).famille;
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam).push(name);
  }
  const platforms = names.length ? `
    <section class="facet-group">
      <h2 class="facet-title">Plateformes</h2>
      ${[...families].map(([fam, list]) => `
        ${families.size > 1 ? `<span class="facet-family">${esc(fam)}</span>` : ''}
        ${list.map((name) => facetButton({
          key: 'platform', value: name, label: name, count: counts.get(name) || 0,
          active: filters.platform === name,
          lead: `<span class="swatch" style="--c:${plateforme(name).trait}"></span>`,
        })).join('')}`).join('')}
    </section>` : '';

  const condKeys = [...CONDITIONS];
  if (allGames().some((g) => !g.condition)) condKeys.push('');
  const conditions = `
    <section class="facet-group">
      <h2 class="facet-title">État</h2>
      ${condKeys.map((c) => facetButton({
        key: 'condition', value: c || '-', label: CONDITION_LABELS[c], count: f.conditions.get(c) || 0,
        active: filters.condition === (c || '-'),
        lead: `<span class="dot" style="${condVar(c)}"></span>`,
      })).join('')}
    </section>`;

  const regionCounts = new Map(f.regions);
  const regionNames = knownValues('region');
  const regions = regionNames.length ? `
    <section class="facet-group">
      <h2 class="facet-title">Région</h2>
      ${regionNames.map((r) => facetButton({
        key: 'region', value: r, label: r, count: regionCounts.get(r) || 0, active: filters.region === r,
        lead: icon('globe', { size: 16 }),
      })).join('')}
    </section>` : '';

  const tags = f.tags.length || filters.tag ? `
    <section class="facet-group">
      <h2 class="facet-title">Tags</h2>
      ${f.tags.slice(0, 24).map(([t, n]) => facetButton({
        key: 'tag', value: t, label: t, count: n, active: filters.tag.toLowerCase() === t.toLowerCase(),
      })).join('')}
    </section>` : '';

  return `<div class="filters-panel">${quick}${platforms}${conditions}${regions}${tags}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Filtres actifs                                                             */
/* -------------------------------------------------------------------------- */

const CHIP = {
  platform: ['Plateforme', (v) => v],
  region: ['Région', (v) => v],
  condition: ['État', (v) => (v === '-' ? CONDITION_LABELS[''] : CONDITION_SHORT[v] || v)],
  tag: ['Tag', (v) => v],
  favorite: ['', () => 'Favoris'],
  incomplete: ['', () => 'Incomplets'],
  iso: ['', (v) => (v === '0' ? 'Sans ISO' : 'Avec ISO')],
};

export function activeFilterCount(filters) {
  return Object.keys(CHIP).filter((k) => filters[k]).length;
}

export function chipsMarkup(filters) {
  const active = Object.keys(CHIP).filter((k) => filters[k]);
  if (!active.length) return '';
  return active.map((key) => {
    const [label, show] = CHIP[key];
    return `<span class="chip">${label ? `<span class="chip-key">${esc(label)}</span>` : ''}${esc(show(filters[key]))}
      <button type="button" data-clear="${key}" aria-label="Retirer le filtre ${esc(label || show(filters[key]))}">${icon('close', { size: 14 })}</button></span>`;
  }).join('') + (active.length > 1 ? '<button type="button" class="chips-clear" data-action="reset-filters">Tout effacer</button>' : '');
}

export { EMPTY_FILTERS };
