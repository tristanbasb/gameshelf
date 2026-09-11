import { api } from './api.js';
import { createBarcodeDetector } from './barcode.js';
import {
  $, $$, esc, toast, openModal, confirmDialog, debounce, initial, store,
  CONDITION_LABELS, CONDITION_SHORT, CONDITION_COLORS,
  PARTS, missingParts, fmtNumber, fmtDate, copyText,
} from './ui.js';

/* ==========================================================================
   Etat
   ========================================================================== */

const CONDITIONS = ['sealed', 'mint', 'good', 'fair', 'poor'];

const state = {
  filters: {
    search: '', platform: '', region: '', condition: '',
    tag: '', favorite: '', incomplete: '', iso: '',
  },
  sort: 'created_at',
  dir: 'desc',
  page: 1,
  limit: store.get('gameshelf-limit') || '60',
  view: store.get('gameshelf-view') || 'grid',
  meta: null,
  instance: { externalSearch: false, secure: false },
};

/* ==========================================================================
   Synchronisation avec l'URL (filtres partageables + bouton retour)
   ========================================================================== */

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  for (const key of Object.keys(state.filters)) {
    state.filters[key] = params.get(key) || '';
  }
  state.sort = params.get('sort') || 'created_at';
  state.dir = params.get('dir') || 'desc';
  state.page = Math.max(Number.parseInt(params.get('page'), 10) || 1, 1);
  if (params.get('limit')) state.limit = params.get('limit');
}

function writeUrl() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) {
    if (value) params.set(key, value);
  }
  if (state.sort !== 'created_at') params.set('sort', state.sort);
  if (state.dir !== 'desc') params.set('dir', state.dir);
  if (state.page > 1) params.set('page', String(state.page));
  if (state.limit !== '60') params.set('limit', state.limit);

  const query = params.toString();
  try {
    window.history.replaceState(null, '', query ? `/?${query}` : '/');
  } catch {
    // Contexte ou l'API History est refusee : la synchronisation de l'URL est
    // un confort, elle ne doit jamais empecher l'affichage de la collection.
  }
}

function resetFilters() {
  for (const key of Object.keys(state.filters)) state.filters[key] = '';
  $('#search').value = '';
  state.page = 1;
}

/* ==========================================================================
   Barre laterale
   ========================================================================== */

function filterButton({ label, count, active, dataset, color }) {
  const button = document.createElement('button');
  button.className = `filter-item${active ? ' active' : ''}`;
  button.type = 'button';
  Object.assign(button.dataset, dataset);
  button.innerHTML = `
    ${color ? `<span class="dot" style="background:${color}"></span>` : ''}
    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</span>
    ${count === undefined ? '' : `<span class="count">${fmtNumber(count)}</span>`}`;
  return button;
}

function renderSidebar() {
  const meta = state.meta;
  if (!meta) return;

  // Etat des exemplaires : ordre fixe, plus une entree "non renseigne"
  // uniquement si des jeux sont concernes.
  const conditionCounts = new Map((meta.by_condition || []).map((r) => [r.label, r.count]));
  const conditionKeys = [...CONDITIONS];
  if ((conditionCounts.get('') || 0) > 0) conditionKeys.push('');

  $('#filter-condition').replaceChildren(
    ...conditionKeys.map((key) =>
      filterButton({
        label: CONDITION_LABELS[key],
        count: conditionCounts.get(key) || 0,
        active: state.filters.condition === key && key !== '',
        dataset: { filter: 'condition', value: key },
        color: CONDITION_COLORS[key],
      }),
    ),
  );

  const fillList = (selector, items, filterKey, max = 14) => {
    const box = $(selector);
    if (!items.length) {
      box.innerHTML =
        '<p style="color:var(--text-faint);font-size:13px;padding:4px 10px">Aucune donnée</p>';
      return;
    }
    box.replaceChildren(
      ...items.slice(0, max).map((item) =>
        filterButton({
          label: item.value,
          count: item.count,
          active: state.filters[filterKey] === item.value,
          dataset: { filter: filterKey, value: item.value },
        }),
      ),
    );
  };

  fillList('#filter-platform', meta.platforms, 'platform');
  fillList('#filter-region', meta.regions, 'region', 10);
  fillList('#filter-tags', meta.tags, 'tag', 12);

  // Listes de saisie assistee des formulaires.
  const fillDatalist = (id, values) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = values.map((v) => `<option value="${esc(v.value)}"></option>`).join('');
  };
  fillDatalist('dl-platforms', meta.platforms);

  // Compteurs et etat actif des vues rapides.
  const totals = meta.totals || {};
  $('#count-all').textContent = fmtNumber(totals.total || 0);
  $('#count-fav').textContent = fmtNumber(totals.favorites || 0);
  $('#count-incomplete').textContent = fmtNumber(totals.incomplete || 0);
  $('#count-noiso').textContent = fmtNumber(totals.without_iso || 0);

  const noFilter = !Object.values(state.filters).some(Boolean);
  const QUICK_STATE = {
    favorite: () => state.filters.favorite === '1',
    incomplete: () => state.filters.incomplete === '1',
    noiso: () => state.filters.iso === '0',
  };
  $$('[data-quick]').forEach((btn) => {
    const test = QUICK_STATE[btn.dataset.quick];
    btn.classList.toggle('active', test ? test() : noFilter);
  });
}

/* ==========================================================================
   Filtres actifs
   ========================================================================== */

const CHIP_LABELS = {
  search: 'Recherche',
  platform: 'Plateforme',
  region: 'Région',
  condition: 'État',
  tag: 'Tag',
  favorite: 'Favoris',
  incomplete: 'Incomplets',
  iso: 'ISO',
};

function renderChips() {
  const box = $('#active-filters');
  const entries = Object.entries(state.filters).filter(([, value]) => value);

  if (entries.length === 0) {
    box.replaceChildren();
    return;
  }

  const shownValue = (key, value) => {
    if (key === 'condition') return CONDITION_LABELS[value] || value;
    if (key === 'favorite' || key === 'incomplete') return 'oui';
    if (key === 'iso') return value === '1' ? 'présent' : 'absent';
    return value;
  };

  const clearAll = document.createElement('button');
  clearAll.className = 'btn btn-ghost';
  clearAll.style.padding = '2px 10px';
  clearAll.style.fontSize = '13px';
  clearAll.textContent = 'Tout effacer';
  clearAll.addEventListener('click', () => {
    resetFilters();
    refresh();
  });

  box.replaceChildren(
    ...entries.map(([key, value]) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${esc(CHIP_LABELS[key])} : ${esc(shownValue(key, value))}
        <button type="button" data-clear="${esc(key)}" aria-label="Retirer ce filtre">×</button>`;
      return chip;
    }),
    clearAll,
  );
}

/* ==========================================================================
   Rendu des jeux
   ========================================================================== */

const STAR_PATH = 'm12 17.3-6.2 3.6 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7z';

/**
 * Fond d'une fiche : la jaquette si elle existe, sinon l'initiale du titre en
 * filigrane. Les images cassees retombent sur ce filigrane, l'evenement
 * `error` etant capture au niveau du conteneur (voir bindEvents) — un
 * gestionnaire en ligne serait bloque par la CSP.
 */
function mediaMarkup(game) {
  if (game.cover_url) {
    return `<img class="cover-main" src="${esc(game.cover_url)}" alt="" loading="lazy"
      data-initial="${esc(initial(game.title))}">`;
  }
  return `<span class="watermark">${esc(initial(game.title))}</span>`;
}

/** Pastille de completude, en haut a gauche de la fiche. */
function completenessTag(game) {
  const missing = missingParts(game);
  if (missing.length === 0) {
    return `<span class="tag tag-ok">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      Complet</span>`;
  }
  return `<span class="tag tag-missing" title="Éléments manquants : ${esc(missing.join(', '))}">sans ${esc(missing.join(', '))}</span>`;
}

function gameCard(game) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = game.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Voir la fiche de ${game.title}`);

  const favLabel = game.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris';
  const condition = game.condition
    ? `<span class="tag tag-cond" style="--cond:${CONDITION_COLORS[game.condition]}">
         <span class="dot" style="background:${CONDITION_COLORS[game.condition]}"></span>
         ${esc(CONDITION_SHORT[game.condition])}
       </span>`
    : '<span class="tag" style="color:var(--text-faint)">État non renseigné</span>';

  card.innerHTML = `
    <div class="card-media">
      ${mediaMarkup(game)}
      <div class="card-scrim"></div>
    </div>

    <div class="card-top">
      ${completenessTag(game)}
      <span style="display:flex;gap:5px;flex:none">
        ${game.quantity > 1 ? `<span class="tag tag-qty" title="${game.quantity} exemplaires">×${game.quantity}</span>` : ''}
        ${game.region ? `<span class="tag tag-region">${esc(game.region)}</span>` : ''}
      </span>
    </div>

    <div class="card-bottom">
      <div>
        <h3 class="card-title" title="${esc(game.title)}">${esc(game.title)}</h3>
        <p class="card-sub">
          <span>${esc(game.platform) || 'Plateforme inconnue'}</span>
          ${game.serial ? `<span class="sep">•</span><span>${esc(game.serial)}</span>` : ''}
        </p>
      </div>
      <div class="card-foot">
        ${condition}
        <button class="fav-btn${game.favorite ? ' on' : ''}" data-fav="${game.id}"
                title="${favLabel}" aria-label="${favLabel}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="${game.favorite ? 'currentColor' : 'none'}"
               stroke="currentColor" stroke-width="2" stroke-linejoin="round">
            <path d="${STAR_PATH}"/>
          </svg>
        </button>
      </div>
    </div>`;
  return card;
}

const TABLE_COLUMNS = [
  { key: 'title', label: 'Titre' },
  { key: 'platform', label: 'Plateforme' },
  { key: 'region', label: 'Région' },
  { key: 'quantity', label: 'Qté' },
  { key: null, label: 'État' },
  { key: null, label: 'Manque' },
  { key: null, label: 'ISO' },
  { key: 'serial', label: 'Serial' },
  { key: null, label: 'Code-barres' },
  { key: 'created_at', label: 'Ajouté le' },
];

function renderTable(items) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';

  const head = TABLE_COLUMNS.map((col) => {
    if (!col.key) return `<th style="cursor:default">${esc(col.label)}</th>`;
    const arrow = state.sort === col.key ? (state.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th data-sort="${col.key}">${esc(col.label)}${arrow}</th>`;
  }).join('');

  const body = items
    .map((game) => {
      const missing = missingParts(game);
      return `
      <tr data-id="${game.id}">
        <td class="title-cell">
          <span class="cell-flex">
            ${game.cover_url
              ? `<img class="mini-cover" src="${esc(game.cover_url)}" alt="" loading="lazy">`
              : '<span class="mini-cover"></span>'}
            <span>${game.favorite ? '★ ' : ''}${esc(game.title)}</span>
          </span>
        </td>
        <td>${esc(game.platform) || '—'}</td>
        <td>${esc(game.region) || '—'}</td>
        <td style="font-variant-numeric:tabular-nums">${game.quantity}</td>
        <td>
          <span class="badge">
            <span class="dot" style="background:${CONDITION_COLORS[game.condition] || 'var(--text-faint)'}"></span>
            ${esc(CONDITION_SHORT[game.condition] ?? game.condition)}
          </span>
        </td>
        <td>${missing.length ? `<span class="missing">${esc(missing.join(', '))}</span>` : '—'}</td>
        <td>${game.has_iso ? 'Oui' : '—'}</td>
        <td style="font-variant-numeric:tabular-nums">${esc(game.serial) || '—'}</td>
        <td style="font-variant-numeric:tabular-nums">${esc(game.ean) || '—'}</td>
        <td>${esc(fmtDate(game.created_at))}</td>
      </tr>`;
    })
    .join('');

  wrap.innerHTML = `<table class="games"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  return wrap;
}

function emptyState() {
  const hasFilters = Object.values(state.filters).some(Boolean);
  const box = document.createElement('div');
  box.className = 'empty';
  box.innerHTML = `
    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <rect x="2" y="6" width="20" height="12" rx="5"/><path d="M6 11h4M8 9v4"/>
      <circle cx="16" cy="12" r=".6" fill="currentColor"/><circle cx="18.5" cy="10" r=".6" fill="currentColor"/>
    </svg>
    <h3>${hasFilters ? 'Aucun jeu ne correspond' : 'Votre collection est vide'}</h3>
    <p>${hasFilters
      ? 'Essayez de modifier ou de retirer les filtres actifs.'
      : 'Ajoutez votre premier jeu, ou importez un fichier CSV existant.'}</p>`;

  const action = document.createElement('button');
  action.className = 'btn btn-primary';
  if (hasFilters) {
    action.textContent = 'Réinitialiser les filtres';
    action.addEventListener('click', () => {
      resetFilters();
      refresh();
    });
  } else {
    action.textContent = 'Ajouter un jeu';
    action.addEventListener('click', () => openGameModal());
  }
  box.appendChild(action);
  return box;
}

function renderPagination(result) {
  const box = $('#pagination');
  if (result.pages <= 1) {
    box.replaceChildren();
    return;
  }

  const makeButton = (label, page, disabled) => {
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', () => {
      state.page = page;
      // C'est la zone catalogue qui defile, pas la fenetre.
      $('#catalog').scrollTo({ top: 0, behavior: 'smooth' });
      refresh();
    });
    return button;
  };

  const info = document.createElement('span');
  info.className = 'page-info';
  info.textContent = `Page ${result.page} sur ${result.pages}`;

  box.replaceChildren(
    makeButton('← Précédent', result.page - 1, result.page <= 1),
    info,
    makeButton('Suivant →', result.page + 1, result.page >= result.pages),
  );
}

function showSkeleton() {
  const wrap = document.createElement('div');
  wrap.className = 'skeleton-grid';
  wrap.innerHTML = '<div class="skeleton"></div>'.repeat(12);
  $('#games-container').replaceChildren(wrap);
}

/*
 * Un filtre se met a jour en une quinzaine de millisecondes : afficher un
 * squelette a chaque interaction produirait un clignotement plus penible que
 * l'attente elle-meme. On ne montre donc un etat de chargement qu'au-dela de
 * ce seuil, et on garde la liste precedente a l'ecran, simplement attenuee.
 */
const LOADING_DELAY_MS = 180;
let loadingTimer = null;

function beginLoading() {
  const container = $('#games-container');
  const hasContent = Boolean(container.querySelector('.card, table, .empty'));
  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(() => {
    if (hasContent) container.classList.add('is-loading');
    else showSkeleton();
  }, LOADING_DELAY_MS);
}

function endLoading() {
  clearTimeout(loadingTimer);
  loadingTimer = null;
  $('#games-container').classList.remove('is-loading');
}

async function loadGames() {
  const params = {
    ...Object.fromEntries(Object.entries(state.filters).filter(([, v]) => v)),
    sort: state.sort,
    dir: state.dir,
    page: state.page,
    limit: state.limit,
  };

  const result = await api.listGames(params);

  // Une page vide au-dela de la derniere : on revient sur la derniere valide.
  if (result.items.length === 0 && result.page > result.pages) {
    state.page = result.pages;
    return loadGames();
  }

  const container = $('#games-container');
  endLoading();
  if (result.items.length === 0) {
    container.replaceChildren(emptyState());
  } else if (state.view === 'table') {
    container.replaceChildren(renderTable(result.items));
  } else {
    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.append(...result.items.map(gameCard));
    container.replaceChildren(grid);
  }

  $('#result-count').textContent =
    result.total === 0 ? 'Aucun jeu' : `${fmtNumber(result.total)} titre${result.total > 1 ? 's' : ''}`;

  // Sous-titre : la plateforme filtree, ou l'unique plateforme de la
  // collection quand il n'y en a qu'une.
  const onlyPlatform = state.meta?.platforms?.length === 1 ? state.meta.platforms[0].value : '';
  const sub = state.filters.platform || onlyPlatform;
  const subEl = $('#result-sub');
  subEl.textContent = sub;
  subEl.hidden = !sub;

  // La pastille ne s'affiche que si elle apprend quelque chose : des
  // exemplaires en double.
  const chip = $('#result-chip');
  const extra = result.copies > result.total;
  chip.textContent = extra ? `${fmtNumber(result.copies)} exemplaires` : '';
  chip.hidden = !extra;

  renderPagination(result);
  return result;
}

async function loadMeta() {
  state.meta = await api.meta();
  renderSidebar();
}

async function refresh({ withMeta = false } = {}) {
  writeUrl();
  renderChips();
  renderSidebar();
  beginLoading();
  try {
    // Les deux requetes sont independantes : les enchainer doublerait
    // inutilement la latence a chaque changement de filtre.
    await Promise.all([withMeta ? loadMeta() : null, loadGames()]);
  } catch (err) {
    $('#games-container').innerHTML =
      `<div class="empty"><h3>Chargement impossible</h3><p>${esc(err.message)}</p></div>`;
  } finally {
    endLoading();
  }
}

/* ==========================================================================
   Scanner de codes-barres
   ========================================================================== */

/*
 * Zone analysee, en fractions de l'apercu. Le viseur affiche exactement ce
 * rectangle : c'est la meme source pour le trait a l'ecran et pour l'image
 * envoyee au decodeur, faute de quoi l'utilisateur viserait a cote.
 */
const RETICULE = { left: 0.06, top: 0.28, width: 0.88, height: 0.44 };

/*
 * Largeur maximale analysee. Mesure faite sur vingt-cinq images de synthese
 * (code occupant 15 a 60 % du champ, flou de 0 a 10 pixels) : de 1024 a
 * 1690 pixels, le taux de lecture ne bouge pas — dix images lues sur
 * vingt-cinq — mais le cout par image, lui, suit la surface. En dessous de
 * 1024 on commence a perdre les petits codes nets. C'est donc le point ou
 * l'on analyse le plus d'images par seconde sans rien lire de moins.
 */
const LARGEUR_ANALYSE_MAX = 1024;

/**
 * Saisit la zone du viseur dans l'image de la camera, a la resolution du
 * capteur. L'apercu etant affiche en `cover`, une partie de l'image deborde
 * du cadre : il faut retrouver la portion reellement visible avant d'y
 * appliquer les fractions du viseur.
 *
 * Le decoupage est confie au navigateur, qui le fait sans sortir les pixels
 * de la carte graphique : 0,1 ms ici, contre une vingtaine de millisecondes
 * pour la meme operation faite a la main sur un canvas. L'image obtenue se
 * transmet ensuite au decodeur sans etre recopiee.
 */
async function saisirZoneViseur(video, frame) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const bw = frame.clientWidth;
  const bh = frame.clientHeight;
  const echelle = Math.max(bw / vw, bh / vh);
  const visibleW = bw / echelle;
  const visibleH = bh / echelle;

  const sx = (vw - visibleW) / 2 + visibleW * RETICULE.left;
  const sy = (vh - visibleH) / 2 + visibleH * RETICULE.top;
  const sw = visibleW * RETICULE.width;
  const sh = visibleH * RETICULE.height;
  if (sw < 1 || sh < 1) return null;

  // La reduction n'est pas appliquee ici : le decodeur la fait lui-meme, de
  // son cote, sans occuper le fil principal.
  const reduction = Math.min(1, LARGEUR_ANALYSE_MAX / sw);
  return {
    image: await createImageBitmap(video, sx, sy, sw, sh),
    largeur: Math.max(1, Math.round(sw * reduction)),
    hauteur: Math.max(1, Math.round(sh * reduction)),
  };
}

/**
 * Reglages de prise de vue disponibles selon l'appareil : mise au point
 * continue, mise au point sur un point precis, eclairage. Tous sont
 * optionnels et silencieusement ignores quand la camera ne les propose pas.
 */
function setupCameraControls(track, modal, status) {
  const caps = track.getCapabilities?.() ?? {};

  /*
   * Les reglages sont poses sans etre attendus. `applyConstraints` demande
   * plusieurs centaines de millisecondes a certains appareils — le temps
   * d'arreter puis de relancer le capteur — et rien dans la lecture n'en
   * depend : la faire patienter ne ferait que retarder le premier essai.
   */
  const regler = (reglage) => {
    track.applyConstraints({ advanced: [reglage] }).catch(() => {
      /* refuse par l'appareil : on garde ce qu'il propose par defaut */
    });
  };

  // Sans autofocus continu, le telephone fait souvent le point sur
  // l'arriere-plan et le code reste flou tant qu'on ne bouge pas.
  if (caps.focusMode?.includes('continuous')) regler({ focusMode: 'continuous' });

  // Toucher l'apercu refait le point a cet endroit.
  const frame = modal.$('#scanner-frame');
  const peutViser = caps.pointsOfInterest || caps.focusMode?.includes('single-shot');
  if (peutViser) {
    frame.classList.add('focusable');
    frame.addEventListener('click', (event) => {
      // Regler le zoom ou l'eclairage n'est pas viser : ces commandes sont
      // posees sur l'apercu, mais ne doivent pas declencher de mise au point.
      if (event.target.closest('.torch-btn, .zoom-range')) return;
      const rect = frame.getBoundingClientRect();
      if (caps.pointsOfInterest) {
        regler({
          pointsOfInterest: [{
            x: (event.clientX - rect.left) / rect.width,
            y: (event.clientY - rect.top) / rect.height,
          }],
        });
      }
      if (caps.focusMode?.includes('single-shot')) regler({ focusMode: 'single-shot' });
      status.textContent = 'Mise au point…';
    });
  }

  // En faible lumiere, le capteur allonge le temps de pose et le moindre
  // mouvement devient flou : l'eclairage regle le probleme a la source.
  if (caps.torch) {
    const bouton = modal.$('#btn-torch');
    bouton.hidden = false;
    let allume = false;
    bouton.addEventListener('click', async () => {
      try {
        await track.applyConstraints({ advanced: [{ torch: !allume }] });
        allume = !allume;
        bouton.classList.toggle('on', allume);
      } catch {
        toast('Éclairage indisponible', 'error');
      }
    });
  }

  // Pour etre lu, un code doit occuper assez de pixels ; s'en approcher bute
  // vite sur la distance minimale de mise au point, en deca de laquelle le
  // telephone ne sait plus faire le point du tout. Le zoom grossit le code
  // sans avoir a approcher : on en applique d'emblee une dose raisonnable, le
  // curseur permettant de revenir en arriere pour retrouver un champ large.
  const zoom = caps.zoom;
  if (zoom && zoom.max > zoom.min) {
    const curseur = modal.$('#scan-zoom');
    // Certains appareils comptent en pourcentage (100 a 400) plutot qu'en
    // facteur : tout est exprime par rapport au minimum, ce qui marche dans
    // les deux cas. Au-dela du double, l'image n'est souvent plus qu'un
    // recadrage numerique, sans pixel supplementaire sur le code.
    const confortable = Math.min(zoom.max, zoom.min * 2);
    curseur.min = zoom.min;
    curseur.max = Math.min(zoom.max, zoom.min * 4);
    curseur.step = zoom.step || (zoom.min >= 100 ? 1 : 0.1);
    curseur.value = confortable;
    curseur.hidden = false;
    regler({ zoom: confortable });
    curseur.addEventListener('input', () => regler({ zoom: Number(curseur.value) }));
  }

  return { peutViser: Boolean(peutViser), torche: Boolean(caps.torch) };
}

/*
 * Cadrages essayes sur une photo, dans l'ordre. `part` est la fraction
 * conservee autour du centre, `largeur` la definition d'analyse.
 *
 * Contrairement a l'apercu video, ou il faut decoder vingt images par
 * seconde, une photo n'est lue qu'une fois : on peut y mettre le prix. Et
 * il le faut. Mesure sur des photos de synthese de 4032 pixels, le code
 * occupant de 8 a 70 % de la largeur : reduite a 1024, l'image a produit un
 * code faux dont la clef de controle tombait juste — le genre d'erreur qui
 * fait repartir avec un jeu que l'on possede deja. A 2200 et au-dela, plus
 * aucune lecture fausse, et tout ce qui depasse 10 % de la largeur est lu.
 */
const CADRAGES_PHOTO = [
  { part: 1, largeur: 2200 },
  { part: 1, largeur: 4032 },
  { part: 0.6, largeur: 2400 },
];

/**
 * Cherche un code-barres sur une photo. Renvoie le code, ou null si aucun
 * cadrage n'a rien donne.
 */
async function lireCodeSurPhoto(fichier, lecteur) {
  let source;
  try {
    // Sans cette option, une photo prise en portrait arrive parfois couchee :
    // ses pixels sont stockes a plat, l'orientation n'etant qu'une etiquette.
    source = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
  } catch {
    source = await createImageBitmap(fichier);
  }

  try {
    for (const { part, largeur } of CADRAGES_PHOTO) {
      const sw = source.width * part;
      const sh = source.height * part;
      const reduction = Math.min(1, largeur / sw);
      const vignette = await createImageBitmap(
        source,
        (source.width - sw) / 2,
        (source.height - sh) / 2,
        sw,
        sh,
      );
      const codes = await lecteur.detect(
        vignette,
        Math.max(1, Math.round(sw * reduction)),
        Math.max(1, Math.round(sh * reduction)),
      );
      if (codes[0]?.rawValue) return codes[0].rawValue;
    }
    return null;
  } finally {
    source.close?.();
  }
}

/**
 * Ouvre la modale de scan. `onDetect(code)` recoit le code lu ; s'il renvoie
 * true, la modale se ferme. Sans callback, on interroge la collection.
 */
async function openScanModal({ onDetect } = {}) {
  let stopped = false;
  let stream = null;
  let detecteur = null;
  let detecteurPromesse = null;

  /*
   * Un seul decodeur pour la modale entiere : l'apercu video et la photo s'en
   * partagent un, charge au premier des deux qui en a besoin. Il pese 350 Ko
   * et ouvre un worker — en ouvrir deux serait un gaspillage pur.
   */
  const obtenirLecteur = () => {
    detecteurPromesse ??= createBarcodeDetector().then((lecteur) => {
      if (stopped) {
        lecteur.close();
        return null;
      }
      detecteur = lecteur;
      return lecteur;
    });
    return detecteurPromesse;
  };

  const stopCamera = () => {
    stopped = true;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    // Le decodeur tourne dans un worker : sans arret explicite, il survivrait
    // a la fermeture de la modale et occuperait la memoire pour rien.
    detecteur?.close();
    detecteur = null;
  };

  const modal = openModal('tpl-scan-modal', { onClose: stopCamera });
  const video = modal.$('#scanner-video');
  const status = modal.$('#scanner-status');
  const result = modal.$('#scan-result');

  const handle = async (code) => {
    if (onDetect) {
      if (onDetect(code) !== false) modal.close();
      return;
    }
    await showLookup(code, modal, result, status);
  };

  modal.$('#btn-scan-manual').addEventListener('click', () => {
    const code = modal.$('#scan-manual').value.trim();
    if (!code) {
      toast('Saisissez un code-barres', 'error');
      return;
    }
    handle(code);
  });
  modal.$('#scan-manual').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      modal.$('#btn-scan-manual').click();
    }
  });

  /*
   * Lecture sur photo. C'est l'appareil photo du systeme qui prend l'image,
   * avec tout ce que le navigateur ne sait pas faire du flux video : mise au
   * point macro, stabilisation, pleine definition. Un code y occupe dix fois
   * plus de pixels, et rien n'a besoin d'etre net au bon millieme de seconde.
   *
   * Seul un champ de fichier est en jeu : aucune permission camera, et cela
   * fonctionne meme en HTTP simple, la ou l'apercu video est refuse.
   */
  const champPhoto = modal.$('#scan-photo');
  champPhoto.addEventListener('change', async () => {
    const fichier = champPhoto.files?.[0];
    // Vider le champ tout de suite : reprendre deux fois la meme boite doit
    // relancer la lecture, or a valeur identique aucun evenement ne part.
    champPhoto.value = '';
    if (!fichier) return;

    status.textContent = 'Lecture de la photo…';
    try {
      const lecteur = await obtenirLecteur();
      if (!lecteur) return;
      const code = await lireCodeSurPhoto(fichier, lecteur);
      if (!code) {
        status.textContent =
          'Aucun code-barres sur cette photo. Reprenez-la de plus près, '
          + 'le code bien à plat et entier dans l’image.';
        return;
      }
      navigator.vibrate?.(60);
      modal.$('#scan-manual').value = code;
      status.textContent = `Code ${code} : recherche…`;
      await handle(code);
    } catch (err) {
      status.textContent = `Photo illisible : ${err.message}`;
    }
  });

  // --- Disponibilite de la camera -------------------------------------------
  if (!window.isSecureContext) {
    // Sur un reseau local, l'application sert aussi en HTTPS auto-signe : on
    // propose directement la bonne adresse plutot qu'un message abstrait.
    // (Uniquement depuis une origine http:, sinon l'URL reconstruite n'a pas
    // de sens — page ouverte depuis un fichier local, par exemple.)
    if (window.location.protocol === 'http:') {
      const secureUrl = `https://${window.location.host}${window.location.pathname}${window.location.search}`;
      status.innerHTML =
        'La caméra exige une connexion sécurisée.<br>'
        + `Ouvrez plutôt <a href="${esc(secureUrl)}">${esc(secureUrl)}</a>`
        + ' et acceptez l’avertissement de certificat.<br>'
        + 'La photo, elle, fonctionne d’ici.';
    } else {
      status.textContent =
        'La caméra exige une connexion sécurisée (HTTPS ou localhost). '
        + 'Photographiez le code, ou saisissez-le ci-dessous.';
    }
    modal.$('#scanner-frame').hidden = true;
    return;
  }
  // `createImageBitmap` sert a decouper le viseur sans bloquer l'affichage :
  // sans lui, autant l'annoncer que de laisser un apercu qui ne lit rien.
  if (!navigator.mediaDevices?.getUserMedia || typeof createImageBitmap !== 'function') {
    status.textContent =
      "Ce navigateur ne donne pas accès à la caméra en direct. "
      + "Photographiez le code, ou saisissez-le à la main.";
    modal.$('#scanner-frame').hidden = true;
    return;
  }

  try {
    status.textContent = 'Préparation du lecteur…';
    /*
     * Le decodeur se prepare pendant que la camera demarre. Les deux prennent
     * chacun quelques centaines de millisecondes — autorisation, ouverture du
     * capteur d'un cote, 350 Ko de decodeur de l'autre : les mener de front
     * economise l'attente la plus courte des deux.
     */
    const lecteurPret = obtenirLecteur().then(
      (lecteur) => ({ lecteur }),
      (erreur) => ({ erreur }),
    );

    // La camera est demandee en premier : c'est elle qui declenche la
    // demande d'autorisation, et le geste de l'utilisateur est encore frais.
    // Une definition elevee laisse davantage de pixels sur le code une fois
    // la zone du viseur decoupee. `ideal` plutot qu'`exact` : un appareil qui
    // ne sait pas faire renvoie sa meilleure definition au lieu d'echouer.
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    if (stopped) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    video.srcObject = stream;
    await video.play();

    const track = stream.getVideoTracks()[0];
    const controles = setupCameraControls(track, modal, status);

    // Le viseur affiche exactement la zone analysee.
    const frame = modal.$('#scanner-frame');
    const reticule = modal.$('.scanner-reticle');
    reticule.style.left = `${RETICULE.left * 100}%`;
    reticule.style.top = `${RETICULE.top * 100}%`;
    reticule.style.right = `${(1 - RETICULE.left - RETICULE.width) * 100}%`;
    reticule.style.bottom = `${(1 - RETICULE.top - RETICULE.height) * 100}%`;

    // Safari n'a pas d'API de lecture : createBarcodeDetector retombe alors
    // sur le decodeur embarque, mis en route pendant le demarrage camera.
    const { lecteur, erreur } = await lecteurPret;
    if (erreur) throw erreur;
    // Nul quand la modale s'est fermee entre-temps : le lecteur a deja ete
    // rendu par `obtenirLecteur`, il n'y a plus rien a faire ici.
    if (!lecteur || stopped) return;

    let lastCode = '';
    status.textContent = controles.peutViser
      ? 'Cadrez le code dans le rectangle. Touchez l’image pour refaire le point.'
      : 'Cadrez le code-barres dans le rectangle.';

    // Passe un certain temps sans rien lire, ce n'est pas le cadrage qui est
    // en cause mais presque toujours la taille du code ou la lumiere : on dit
    // quoi corriger plutot que de laisser l'utilisateur insister.
    const conseil = setTimeout(() => {
      if (stopped || lastCode) return;
      status.textContent = controles.torche
        ? 'Rien pour l’instant : rapprochez-vous, ou allumez l’éclairage.'
        : 'Rien pour l’instant : rapprochez-vous un peu du code.';
    }, 6000);

    let enCours = false;
    const analyser = async () => {
      if (stopped || enCours) return;
      enCours = true;
      try {
        const zone = await saisirZoneViseur(video, frame);
        if (!zone) return;
        if (stopped) {
          zone.image.close?.();
          return;
        }
        const codes = await lecteur.detect(zone.image, zone.largeur, zone.hauteur);
        const code = codes[0]?.rawValue;
        if (code && code !== lastCode && !stopped) {
          lastCode = code;
          clearTimeout(conseil);
          navigator.vibrate?.(60);
          // Phrase volontairement inachevee : la recherche la termine, sans
          // faire clignoter deux messages differents au meme endroit.
          status.textContent = `Code ${code} : recherche…`;
          modal.$('#scan-manual').value = code;
          await handle(code);
          // On oublie le dernier code au bout de deux secondes : viser a
          // nouveau la meme boite doit redonner une reponse, sans avoir a
          // rouvrir la modale.
          setTimeout(() => { if (lastCode === code) lastCode = ''; }, 2000);
        }
      } catch {
        /* image illisible sur cette frame : on retente */
      } finally {
        enCours = false;
      }
    };

    /*
     * Une tentative par image affichee, jamais deux de front. Le decodage a
     * lieu ailleurs, mais empiler des images que le decodeur n'aura pas le
     * temps de traiter ne ferait qu'allonger le delai entre ce que montre
     * l'apercu et ce qui est analyse. `requestVideoFrameCallback` ne rappelle
     * qu'a l'arrivee d'une image reellement nouvelle ; a defaut, cadence fixe.
     */
    const aLaProchaineImage = typeof video.requestVideoFrameCallback === 'function'
      ? (fn) => video.requestVideoFrameCallback(fn)
      : (fn) => setTimeout(fn, 60);

    const boucle = async () => {
      if (stopped) return;
      await analyser();
      if (!stopped) aLaProchaineImage(boucle);
    };
    aLaProchaineImage(boucle);
  } catch (err) {
    modal.$('#scanner-frame').hidden = true;
    status.textContent =
      err?.name === 'NotAllowedError'
        ? "Accès à la caméra refusé. Autorisez-le, ou saisissez le code à la main."
        : `Caméra indisponible : ${err.message}. Saisissez le code à la main.`;
    modal.$('#scan-manual').focus();
  }
}

/** Affiche le resultat d'une recherche par code-barres. */
async function showLookup(code, modal, result, status) {
  result.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Recherche…</p>';
  try {
    const data = await api.lookup(code);

    if (!data.found) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'scan-hit miss';
      add.innerHTML = `
        <span style="min-width:0">
          <span class="h-title">Pas dans votre collection</span><br>
          <span class="h-meta">Code ${esc(data.ean)} — cliquez pour l'ajouter</span>
        </span>`;
      add.addEventListener('click', () => {
        modal.close();
        openGameModal(null, { ean: data.ean });
      });
      result.replaceChildren(add);
      // Le code lu reste affiche : sans lui, on ne sait plus si la reponse
      // porte sur la boite que l'on vient de viser ou sur la precedente.
      status.textContent = `Code ${code} : aucune correspondance.`;
      return;
    }

    const n = data.games.length;
    status.textContent = `Code ${code} : ${n} jeu${n > 1 ? 'x' : ''} trouvé${n > 1 ? 's' : ''}.`;
    result.replaceChildren(
      ...data.games.map((game) => {
        const missing = missingParts(game);
        const hit = document.createElement('button');
        hit.type = 'button';
        hit.className = 'scan-hit';
        hit.innerHTML = `
          <span style="min-width:0">
            <span class="h-title">✓ Vous l'avez déjà : ${esc(game.title)}</span><br>
            <span class="h-meta">${[
              esc(game.platform),
              `${game.quantity} exemplaire${game.quantity > 1 ? 's' : ''}`,
              game.condition ? esc(CONDITION_SHORT[game.condition]) : '',
              missing.length ? `sans ${esc(missing.join(', '))}` : '',
            ].filter(Boolean).join(' · ')}</span>
          </span>`;
        hit.addEventListener('click', () => {
          modal.close();
          openGame(game.id);
        });
        return hit;
      }),
    );
  } catch (err) {
    result.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
  }
}

/* ==========================================================================
   Suppression annulable
   ========================================================================== */

/**
 * Une suppression est definitive et souvent regrettee dans la seconde qui
 * suit. On laisse donc une fenetre de rattrapage dans la notification.
 *
 * La restauration recree la fiche : elle retrouve tous ses champs, mais
 * recoit un nouvel identifiant et une nouvelle date d'ajout. C'est sans
 * consequence pour un inventaire, et bien preferable a une perte seche.
 */
function offerUndoDelete(game) {
  toast(`« ${game.title} » supprimé`, 'success', {
    duration: 9000,
    action: {
      label: 'Annuler',
      onClick: async () => {
        try {
          await api.createGame(game);
          toast(`« ${game.title} » restauré`);
          refresh({ withMeta: true });
        } catch (err) {
          toast(`Restauration impossible : ${err.message}`, 'error');
        }
      },
    },
  });
}

/* ==========================================================================
   Modale : fiche detaillee
   ========================================================================== */

/** Une ligne du tableau de caracteristiques ; vide, elle affiche un tiret. */
function detailRow(label, value, { mono = false } = {}) {
  const absent = value === '' || value === null || value === undefined;
  return `<dt>${esc(label)}</dt>
    <dd class="${absent ? 'absent' : ''}${mono && !absent ? ' mono' : ''}">${absent ? '—' : esc(value)}</dd>`;
}

const CHECK_ICON =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const CHECK_ICON_LARGE =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const CROSS_ICON =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

/**
 * Fiche de consultation : tout ce qu'on sait du jeu, d'un coup d'oeil.
 * L'edition reste accessible depuis le pied de la fiche, mais n'est plus
 * imposee a chaque clic — on consulte bien plus souvent qu'on ne corrige.
 */
function openDetailModal(game) {
  const modal = openModal('tpl-detail-modal');

  // --- Visuel -------------------------------------------------------------
  modal.$('#detail-media').innerHTML = game.cover_url
    ? `<img src="${esc(game.cover_url)}" alt="Jaquette de ${esc(game.title)}">`
    : `<span class="watermark">${esc(initial(game.title))}</span>`;

  // --- Identite -----------------------------------------------------------
  modal.$('#detail-name').textContent = game.title;
  modal.$('#detail-sub').textContent =
    [game.platform, game.region].filter(Boolean).join(' · ') || 'Plateforme non renseignée';

  // Copie du titre, pour le coller dans une recherche ou une annonce.
  const copyButton = modal.$('#detail-copy');
  const copyIcon = copyButton.innerHTML;
  copyButton.addEventListener('click', async () => {
    if (!(await copyText(game.title))) {
      toast('Copie impossible sur ce navigateur', 'error');
      return;
    }
    // La coche remplace l'icone un instant : plus lisible qu'une notification
    // pour un geste aussi bref.
    copyButton.classList.add('done');
    copyButton.innerHTML = CHECK_ICON_LARGE;
    setTimeout(() => {
      copyButton.classList.remove('done');
      copyButton.innerHTML = copyIcon;
    }, 1400);
  });

  // --- Pastilles de synthese ----------------------------------------------
  // Recalculees a la demande : cocher un element de contenu doit faire passer
  // la fiche de « sans notice » a « Complet » sans la rouvrir.
  function refreshDetailSummary() {
    const missing = missingParts(game);
    const tags = [
      missing.length
        ? `<span class="tag tag-missing">sans ${esc(missing.join(', '))}</span>`
        : `<span class="tag tag-ok">${CHECK_ICON} Complet</span>`,
    ];
    if (game.condition) {
      tags.push(`<span class="tag tag-cond" style="--cond:${CONDITION_COLORS[game.condition]}">
        <span class="dot" style="background:${CONDITION_COLORS[game.condition]}"></span>
        ${esc(CONDITION_LABELS[game.condition])}</span>`);
    }
    if (game.quantity > 1) {
      tags.push(`<span class="tag tag-qty">×${game.quantity} exemplaires</span>`);
    }
    if (game.has_iso) tags.push(`<span class="tag tag-ok">${CHECK_ICON} ISO</span>`);
    modal.$('#detail-tags').innerHTML = tags.join('');
  }
  refreshDetailSummary();

  // --- Caracteristiques ---------------------------------------------------
  modal.$('#detail-rows').innerHTML = [
    detailRow('Plateforme', game.platform),
    detailRow('Région', game.region),
    detailRow('Serial', game.serial, { mono: true }),
    detailRow('Code-barres', game.ean, { mono: true }),
    detailRow('Quantité', `${game.quantity} exemplaire${game.quantity > 1 ? 's' : ''}`),
    detailRow('État', game.condition ? CONDITION_LABELS[game.condition] : ''),
    detailRow('Sauvegarde ISO', game.has_iso ? 'Oui' : 'Non'),
  ].join('');

  // --- Contenu de l'exemplaire --------------------------------------------
  // Retrouver une notice au fond d'un carton est frequent : chaque element se
  // corrige d'un clic, sans ouvrir le formulaire.
  const partsBox = modal.$('#detail-parts');
  const renderParts = () => {
    partsBox.innerHTML = PARTS.map((part) => {
      const present = Boolean(game[part.key]);
      return `<button type="button" class="part ${present ? 'present' : 'absent'}"
        data-part="${part.key}" title="${present ? 'Marquer comme manquant' : 'Marquer comme présent'}">
        ${present ? CHECK_ICON : CROSS_ICON}${esc(part.label)}</button>`;
    }).join('');
  };
  renderParts();

  partsBox.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-part]');
    if (!button) return;
    const key = button.dataset.part;
    const avant = game[key];

    game[key] = avant ? 0 : 1;
    renderParts();
    try {
      Object.assign(game, await api.updateGame(game.id, { [key]: game[key] }));
      renderParts();
      refreshDetailSummary();
      refresh({ withMeta: true });
    } catch (err) {
      game[key] = avant;
      renderParts();
      toast(err.message, 'error');
    }
  });

  // --- Tags et notes, masques quand ils sont vides -------------------------
  const tagList = game.tags ? game.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
  modal.$('#detail-taglist-block').hidden = tagList.length === 0;
  modal.$('#detail-taglist').innerHTML = tagList
    .map((tag) => `<span class="tag-plain">${esc(tag)}</span>`)
    .join('');

  modal.$('#detail-notes-block').hidden = !game.notes;
  modal.$('#detail-notes').textContent = game.notes || '';

  const added = fmtDate(game.created_at);
  const updated = fmtDate(game.updated_at);
  modal.$('#detail-dates').textContent =
    updated && updated !== added
      ? `Ajouté le ${added} · modifié le ${updated}`
      : `Ajouté le ${added}`;

  // --- Actions ------------------------------------------------------------
  const favButton = modal.$('#detail-fav');
  const paintFav = (on) => {
    favButton.textContent = on ? '★ Retirer des favoris' : '☆ Ajouter aux favoris';
  };
  paintFav(Boolean(game.favorite));
  favButton.addEventListener('click', async () => {
    const before = Boolean(game.favorite);
    paintFav(!before);
    try {
      const updatedGame = await api.toggleFavorite(game.id);
      game.favorite = updatedGame.favorite;
      paintFav(Boolean(game.favorite));
      refresh({ withMeta: true });
    } catch (err) {
      paintFav(before);
      toast(err.message, 'error');
    }
  });

  modal.$('#detail-edit').addEventListener('click', () => {
    modal.close();
    openGameModal(game);
  });

  modal.$('#detail-delete').addEventListener('click', async () => {
    const ok = await confirmDialog(
      `Supprimer « ${game.title} » de la collection ? Cette action est définitive.`,
      { confirmLabel: 'Supprimer', title: 'Supprimer le jeu' },
    );
    if (!ok) return;
    try {
      await api.deleteGame(game.id);
      modal.close();
      offerUndoDelete(game);
      refresh({ withMeta: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ==========================================================================
   Modale : formulaire d'un jeu
   ========================================================================== */

const FORM_FIELDS = [
  ['f-title', 'title'], ['f-cover', 'cover_url'], ['f-platform', 'platform'],
  ['f-region', 'region'], ['f-serial', 'serial'], ['f-ean', 'ean'],
  ['f-quantity', 'quantity'], ['f-condition', 'condition'],
  ['f-tags', 'tags'], ['f-notes', 'notes'],
];

function openGameModal(game = null, prefill = {}) {
  const modal = openModal('tpl-game-modal');
  const isEdit = Boolean(game);

  modal.$('#game-modal-title').textContent = isEdit ? 'Modifier le jeu' : 'Ajouter un jeu';

  const coverInput = modal.$('#f-cover');
  const updatePreview = () => updateCoverPreview(modal);

  if (isEdit) {
    for (const [id, key] of FORM_FIELDS) {
      const el = modal.$(`#${id}`);
      if (el) el.value = game[key] ?? '';
    }
    modal.$('#f-favorite').checked = Boolean(game.favorite);
    modal.$('#f-has_iso').checked = Boolean(game.has_iso);
    for (const part of PARTS) {
      modal.$(`#f-${part.key}`).checked = Boolean(game[part.key]);
    }
    updatePreview();

    const deleteButton = modal.$('#btn-delete');
    deleteButton.hidden = false;
    deleteButton.addEventListener('click', async () => {
      const ok = await confirmDialog(
        `Supprimer « ${game.title} » de la collection ? Cette action est définitive.`,
        { confirmLabel: 'Supprimer', title: 'Supprimer le jeu' },
      );
      if (!ok) return;
      try {
        await api.deleteGame(game.id);
        modal.close();
        toast('Jeu supprimé');
        refresh({ withMeta: true });
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  } else {
    // Cataloguer une etagere, c'est enchainer des jeux de la meme plateforme,
    // de la meme region et souvent du meme etat : on repart des dernieres
    // valeurs saisies.
    modal.$('#f-platform').value = store.get('gameshelf-last-platform') || '';
    modal.$('#f-region').value = store.get('gameshelf-last-region') || '';
    modal.$('#f-condition').value = store.get('gameshelf-last-condition') || '';

    for (const [key, value] of Object.entries(prefill)) {
      const el = modal.$(`#f-${key}`);
      if (el) el.value = value;
    }
    modal.$('#btn-save-again').hidden = false;
    modal.$('#f-title').focus();
  }

  coverInput.addEventListener('input', debounce(updatePreview, 400));
  modal.$('#btn-clear-cover').addEventListener('click', () => {
    coverInput.value = '';
    updatePreview();
  });

  // Scan du code-barres depuis le formulaire
  modal.$('#btn-scan-field').addEventListener('click', () => {
    openScanModal({
      onDetect: (code) => {
        modal.$('#f-ean').value = code.replace(/[\s-]/g, '');
        toast(`Code-barres : ${code}`);
        return true;
      },
    });
  });

  // Televersement d'un visuel
  const fileInput = modal.$('#file-cover');
  modal.$('#btn-upload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const button = modal.$('#btn-upload');
    button.disabled = true;
    button.textContent = 'Envoi…';
    try {
      const { url } = await api.uploadCover(file);
      coverInput.value = url;
      updatePreview();
      toast('Image téléversée');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Téléverser une image';
      fileInput.value = '';
    }
  });

  // Recherche en ligne (RAWG), si une cle API est configuree.
  if (state.instance.externalSearch) {
    const lookupButton = modal.$('#btn-lookup');
    lookupButton.hidden = false;
    lookupButton.addEventListener('click', () => runLookup(modal));
  }

  // Enregistrement
  async function save({ keepOpen = false } = {}) {
    const payload = {
      favorite: modal.$('#f-favorite').checked ? 1 : 0,
      has_iso: modal.$('#f-has_iso').checked ? 1 : 0,
    };
    for (const [id, key] of FORM_FIELDS) {
      const el = modal.$(`#${id}`);
      if (el) payload[key] = el.value.trim();
    }
    for (const part of PARTS) {
      payload[part.key] = modal.$(`#f-${part.key}`).checked ? 1 : 0;
    }
    if (!payload.title) {
      toast('Le titre est obligatoire', 'error');
      modal.$('#f-title').focus();
      return;
    }

    const buttons = [modal.$('#btn-save'), modal.$('#btn-save-again')];
    buttons.forEach((b) => { b.disabled = true; });
    modal.$('#btn-save').textContent = 'Enregistrement…';

    try {
      if (isEdit) await api.updateGame(game.id, payload);
      else await api.createGame(payload);

      // Memorise le contexte de saisie pour la fiche suivante.
      store.set('gameshelf-last-platform', payload.platform);
      store.set('gameshelf-last-region', payload.region);
      store.set('gameshelf-last-condition', payload.condition);

      if (keepOpen) {
        // On ne vide que ce qui change d'un jeu a l'autre.
        for (const id of ['f-title', 'f-serial', 'f-ean', 'f-cover', 'f-tags', 'f-notes']) {
          modal.$(`#${id}`).value = '';
        }
        modal.$('#f-quantity').value = '1';
        modal.$('#f-favorite').checked = false;
        modal.$('#f-has_iso').checked = false;
        for (const part of PARTS) modal.$(`#f-${part.key}`).checked = true;
        updatePreview();
        modal.$('#lookup-results').innerHTML = '';
        modal.$('#f-title').focus();
        toast(`« ${payload.title} » ajouté — au suivant`);
      } else {
        modal.close();
        toast(isEdit ? 'Jeu mis à jour' : 'Jeu ajouté');
      }
      refresh({ withMeta: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
      modal.$('#btn-save').textContent = 'Enregistrer';
    }
  }

  modal.$('#game-form').addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });
  modal.$('#btn-save-again').addEventListener('click', () => save({ keepOpen: true }));
}

async function runLookup(modal) {
  const query = modal.$('#f-title').value.trim();
  const box = modal.$('#lookup-results');
  if (query.length < 2) {
    toast('Saisissez au moins 2 caractères dans le titre', 'info');
    return;
  }

  const pending = '<p style="color:var(--text-muted);font-size:13px;margin:8px 0">Recherche…</p>';
  box.innerHTML = pending;

  try {
    const { results } = await api.searchExternal(query);
    if (!results.length) {
      box.innerHTML = '<p style="color:var(--text-muted);font-size:13px;margin:8px 0">Aucun résultat</p>';
      return;
    }

    const list = document.createElement('div');
    list.className = 'suggestions';
    for (const item of results) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'suggestion';
      button.innerHTML = `
        ${item.cover_url ? `<img src="${esc(item.cover_url)}" alt="" loading="lazy">` : '<span class="mini-cover"></span>'}
        <span style="min-width:0">
          <span class="s-title">${esc(item.title)}</span><br>
          <span class="s-meta">${[item.release_year, item.platforms.slice(0, 3).join(', ')]
            .filter(Boolean).map(esc).join(' · ')}</span>
        </span>`;
      button.addEventListener('click', async () => {
        box.innerHTML = pending;
        try {
          const detail = await api.externalGame(item.external_id);
          const apply = (id, value) => {
            const el = modal.$(`#${id}`);
            if (el && value) el.value = value;
          };
          apply('f-title', detail.title);
          apply('f-cover', detail.cover_url);
          if (!modal.$('#f-platform').value && detail.platforms?.length) {
            modal.$('#f-platform').value = detail.platforms[0];
          }
          if (!modal.$('#f-tags').value) apply('f-tags', detail.tags);
          updateCoverPreview(modal);
          box.innerHTML = '';
          toast('Fiche pré-remplie');
        } catch (err) {
          box.innerHTML = '';
          toast(err.message, 'error');
        }
      });
      list.appendChild(button);
    }
    box.replaceChildren(list);
  } catch (err) {
    box.innerHTML = '';
    toast(err.message, 'error');
  }
}

/** Affiche le visuel courant du formulaire dans l'encadre d'apercu. */
function updateCoverPreview(modal) {
  const url = modal.$('#f-cover').value.trim();
  const preview = modal.$('#cover-preview');
  if (!url) {
    preview.textContent = 'Aucune image';
    return;
  }
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.addEventListener('error', () => {
    preview.textContent = 'Image indisponible';
  });
  preview.replaceChildren(img);
}

/* ==========================================================================
   Modale : import / export
   ========================================================================== */

function openIoModal() {
  const modal = openModal('tpl-io-modal');
  const fileInput = modal.$('#import-file');
  const report = modal.$('#import-report');

  // L'export suit les filtres affiches : sortir la liste des jeux auxquels il
  // manque la notice se fait en filtrant puis en exportant, sans retouche.
  const actifs = Object.entries(state.filters).filter(([, v]) => v);
  const query = new URLSearchParams(Object.fromEntries(actifs));
  modal.$('#export-csv').href = `/api/export?format=csv&${query}`;
  modal.$('#export-json').href = `/api/export?format=json&${query}`;
  modal.$('#export-scope').textContent = actifs.length
    ? `Seuls les jeux correspondant aux filtres en cours (${actifs
      .map(([key]) => CHIP_LABELS[key].toLowerCase())
      .join(', ')}).`
    : 'Toute la collection.';

  modal.$('#btn-do-import').addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      toast('Choisissez un fichier à importer', 'error');
      return;
    }

    const mode = modal.$('#import-mode').value;
    if (mode === 'replace') {
      const ok = await confirmDialog(
        'Le mode « remplacer » efface toute la collection actuelle avant l’import. Continuer ?',
        { confirmLabel: 'Remplacer', title: 'Remplacer la collection' },
      );
      if (!ok) return;
    }

    const button = modal.$('#btn-do-import');
    button.disabled = true;
    button.textContent = 'Import en cours…';
    try {
      const content = await file.text();
      const format = /\.json$/i.test(file.name) ? 'json' : 'csv';
      const result = await api.importData(
        content,
        format,
        mode,
        modal.$('#import-platform').value.trim(),
      );

      const details = result.details?.length
        ? `<details style="margin-top:8px"><summary style="cursor:pointer">Voir les lignes ignorées</summary>
             <ul style="margin:8px 0 0;padding-left:18px">${result.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
           </details>`
        : '';
      report.innerHTML = `
        <div class="form-error" style="background:var(--accent-soft);color:var(--accent);border-color:var(--accent)">
          ${result.imported} jeu(x) importé(s), ${result.skipped} doublon(s) ignoré(s),
          ${result.invalid} ligne(s) invalide(s).${details}
        </div>`;
      toast(`${result.imported} jeu(x) importé(s)`);
      refresh({ withMeta: true });
    } catch (err) {
      report.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
    } finally {
      button.disabled = false;
      button.textContent = 'Importer';
    }
  });
}

/* ==========================================================================
   Theme
   ========================================================================== */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set('gameshelf-theme', theme);
  $('#icon-theme').innerHTML =
    theme === 'dark'
      ? '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'
      : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>';
}

/* ==========================================================================
   Evenements
   ========================================================================== */

function bindEvents() {
  // Recherche
  $('#search').addEventListener(
    'input',
    debounce((event) => {
      state.filters.search = event.target.value.trim();
      state.page = 1;
      refresh();
    }, 320),
  );

  // Filtres de la barre laterale (delegation)
  $('#sidebar').addEventListener('click', (event) => {
    const quick = event.target.closest('[data-quick]');
    if (quick) {
      resetFilters();
      if (quick.dataset.quick === 'favorite') state.filters.favorite = '1';
      if (quick.dataset.quick === 'incomplete') state.filters.incomplete = '1';
      if (quick.dataset.quick === 'noiso') state.filters.iso = '0';
      document.body.classList.remove('sidebar-open');
      refresh();
      return;
    }

    const item = event.target.closest('[data-filter]');
    if (!item) return;
    const { filter, value } = item.dataset;
    state.filters[filter] = state.filters[filter] === value ? '' : value;
    state.page = 1;
    document.body.classList.remove('sidebar-open');
    refresh();
  });

  // Retrait d'un filtre via les puces
  $('#active-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-clear]');
    if (!button) return;
    state.filters[button.dataset.clear] = '';
    if (button.dataset.clear === 'search') $('#search').value = '';
    state.page = 1;
    refresh();
  });

  // Visuel introuvable : on retombe sur l'initiale du titre.
  // L'evenement `error` d'une image ne remonte pas : on ecoute en capture.
  $('#games-container').addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      if (img.classList.contains('mini-cover')) {
        img.removeAttribute('src');
        return;
      }
      const watermark = document.createElement('span');
      watermark.className = 'watermark';
      watermark.textContent = img.dataset.initial || '?';
      img.replaceWith(watermark);
    },
    true,
  );

  // Grille / tableau : bascule favori, tri, ouverture d'une fiche
  $('#games-container').addEventListener('click', async (event) => {
    const favButton = event.target.closest('[data-fav]');
    if (favButton) {
      event.stopPropagation();
      // Bascule optimiste : l'etoile repond au clic, on corrige si le serveur
      // refuse. Attendre l'aller-retour rendrait le geste mou pour rien.
      const paint = (on) => {
        favButton.classList.toggle('on', on);
        favButton.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
      };
      const before = favButton.classList.contains('on');
      paint(!before);
      try {
        const updated = await api.toggleFavorite(favButton.dataset.fav);
        paint(Boolean(updated.favorite));
        loadMeta();
        if (state.filters.favorite === '1') refresh();
      } catch (err) {
        paint(before);
        toast(err.message, 'error');
      }
      return;
    }

    const sortHeader = event.target.closest('[data-sort]');
    if (sortHeader) {
      const key = sortHeader.dataset.sort;
      state.dir = state.sort === key && state.dir === 'asc' ? 'desc' : 'asc';
      state.sort = key;
      $('#sort').value = `${state.sort}:${state.dir}`;
      refresh();
      return;
    }

    const row = event.target.closest('[data-id]');
    if (row) openGame(row.dataset.id);
  });

  $('#games-container').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.card[data-id]');
    if (!card) return;
    event.preventDefault();
    openGame(card.dataset.id);
  });

  // Tri
  $('#sort').addEventListener('change', (event) => {
    const [sort, dir] = event.target.value.split(':');
    state.sort = sort;
    state.dir = dir;
    state.page = 1;
    refresh();
  });

  // Nombre de jeux par page ("Tout afficher" inclus)
  $('#page-size').addEventListener('change', (event) => {
    state.limit = event.target.value;
    store.set('gameshelf-limit', state.limit);
    state.page = 1;
    refresh();
  });

  // Mode d'affichage
  const setView = (view) => {
    state.view = view;
    store.set('gameshelf-view', view);
    $('#view-grid').classList.toggle('active', view === 'grid');
    $('#view-table').classList.toggle('active', view === 'table');
    loadGames();
  };
  $('#view-grid').addEventListener('click', () => setView('grid'));
  $('#view-table').addEventListener('click', () => setView('table'));

  // Actions de l'en-tete
  $('#btn-scan').addEventListener('click', () => openScanModal());
  $('#btn-scan-fab').addEventListener('click', () => openScanModal());
  $('#btn-add').addEventListener('click', () => openGameModal());
  $('#btn-io').addEventListener('click', openIoModal);
  $('#brand-home').addEventListener('click', (event) => {
    event.preventDefault();
    resetFilters();
    refresh();
  });
  $('#btn-theme').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  // Barre laterale mobile
  $('#btn-sidebar').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  $('#sidebar-backdrop').addEventListener('click', () => document.body.classList.remove('sidebar-open'));

  // Raccourcis clavier
  document.addEventListener('keydown', (event) => {
    // Ctrl+K / Cmd+K atteint la recherche depuis n'importe ou, y compris
    // depuis un champ de saisie : c'est la convention annoncee dans l'en-tete.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const search = $('#search');
      search.focus();
      search.select();
      return;
    }

    if (document.querySelector('.modal-backdrop')) return;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);
    if (typing && event.key !== 'Escape') return;

    if (event.key === '/') {
      event.preventDefault();
      $('#search').focus();
    } else if ((event.key === 'n' || event.key === 'N') && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      openGameModal();
    } else if ((event.key === 's' || event.key === 'S') && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      openScanModal();
    } else if (event.key === 'Escape' && event.target.id === 'search') {
      event.target.value = '';
      state.filters.search = '';
      refresh();
    }
  });

  // Navigation navigateur (precedent / suivant)
  window.addEventListener('popstate', () => {
    readUrl();
    $('#search').value = state.filters.search;
    $('#sort').value = `${state.sort}:${state.dir}`;
    $('#page-size').value = state.limit;
    refresh();
  });
}

async function openGame(id) {
  try {
    openDetailModal(await api.get(`/api/games/${id}`));
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ==========================================================================
   Demarrage
   ========================================================================== */

async function init() {
  applyTheme(store.get('gameshelf-theme') || 'dark');
  readUrl();

  $('#search').value = state.filters.search;
  $('#sort').value = `${state.sort}:${state.dir}`;
  $('#page-size').value = state.limit;
  $('#view-grid').classList.toggle('active', state.view === 'grid');
  $('#view-table').classList.toggle('active', state.view === 'table');

  bindEvents();

  try {
    state.instance = await api.config();
    if (state.instance.version) {
      $('#app-version').textContent = `v${state.instance.version}`;
    }
  } catch {
    /* on continue : les appels suivants signaleront le probleme */
  }

  await refresh({ withMeta: true });

  // Raccourci « Scanner » de l'ecran d'accueil : l'application s'ouvre
  // directement sur la camera, sans passer par la collection.
  if (new URLSearchParams(window.location.search).get('action') === 'scan') {
    writeUrl();
    openScanModal();
  }
}

init();
