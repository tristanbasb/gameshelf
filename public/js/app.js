import { api } from './api.js';
import { createBarcodeDetector } from './barcode.js';
import {
  $, $$, esc, toast, openModal, confirmDialog, debounce, store,
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
 * Teinte d'une jaquette fabriquee, tiree du titre.
 *
 * Le calcul est volontairement simple et stable : le meme jeu garde toujours
 * la meme couleur, d'une session a l'autre et d'un appareil a l'autre. C'est
 * ce qui permet de retrouver un exemplaire a sa couleur dans la grille, comme
 * on retrouve une boite a sa tranche sur une etagere.
 */
function teinteDuTitre(titre) {
  let somme = 0;
  for (let i = 0; i < titre.length; i += 1) {
    somme = (somme * 31 + titre.charCodeAt(i)) % 360;
  }
  return somme;
}

/**
 * Jaquette fabriquee a partir du seul titre, pour les exemplaires sans visuel.
 *
 * La vitrine repose entierement sur l'image ; laisser un cadre vide reviendrait
 * a la vider de son propos. Trois mots au plus, composes grand sur un degrade :
 * cela se lit comme une pochette, et non comme une case en attente.
 */
function coverGeneree(titre) {
  const texte = String(titre || '?').trim() || '?';
  // Le titre est compose entier et coupe a trois lignes par le style : le
  // decouper ici en mots donnait des morceaux absurdes — « The Fast and ».
  return `<div class="cover-genere" style="--teinte:${teinteDuTitre(texte)}"
    ><span>${esc(texte)}</span></div>`;
}

/**
 * Fond d'une tuile : la jaquette si elle existe, sinon celle que l'on
 * fabrique. Les images cassees retombent sur la meme fabrique, l'evenement
 * `error` etant capture au niveau du conteneur (voir bindEvents) — un
 * gestionnaire en ligne serait bloque par la CSP.
 */
function mediaMarkup(game) {
  if (game.cover_url) {
    // Deux fois la meme source : l'une floutee en fond pour remplir la tuile,
    // l'autre entiere par-dessus. Le navigateur ne la telecharge qu'une fois.
    return `<img class="cover-fond" src="${esc(game.cover_url)}" alt="" aria-hidden="true" loading="lazy">
      <img class="cover-main" src="${esc(game.cover_url)}" alt="" loading="lazy"
        data-titre="${esc(game.title)}">`;
  }
  return coverGeneree(game.title);
}

/** Les quatre elements d'un exemplaire, reveles au survol de la tuile. */
function partChips(game) {
  return PARTS.map((part) => {
    const present = Boolean(game[part.key]);
    return `<span class="part-chip ${present ? 'ok' : 'ko'}"
      title="${esc(part.label)} : ${present ? 'présente' : 'absente'}">${esc(part.court)}</span>`;
  }).join('');
}

function gameCard(game) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = game.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Voir la fiche de ${game.title}`);

  const favLabel = game.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris';
  const manque = missingParts(game);
  const couleur = CONDITION_COLORS[game.condition] || 'var(--text-faint)';

  card.innerHTML = `
    <div class="card-media">
      ${mediaMarkup(game)}
      <div class="card-scrim"></div>
    </div>

    <div class="card-top">
      <span style="display:flex;gap:5px;min-width:0">
        ${game.region ? `<span class="tag tag-region">${esc(game.region)}</span>` : ''}
        ${manque.length
          ? `<span class="tag tag-missing" title="Manque : ${esc(manque.join(', '))}"
              >${PARTS.length - manque.length}/${PARTS.length}</span>`
          : ''}
        ${game.quantity > 1
          ? `<span class="tag tag-qty" title="${game.quantity} exemplaires">×${game.quantity}</span>`
          : ''}
      </span>
      <button class="fav-btn${game.favorite ? ' on' : ''}" data-fav="${game.id}"
              title="${favLabel}" aria-label="${favLabel}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${game.favorite ? 'currentColor' : 'none'}"
             stroke="currentColor" stroke-width="2" stroke-linejoin="round">
          <path d="${STAR_PATH}"/>
        </svg>
      </button>
    </div>

    <div class="card-bottom">
      <h3 class="card-title" title="${esc(game.title)}">${esc(game.title)}</h3>
      <p class="card-sub">
        <span class="dot" style="background:${couleur}"></span>
        <span>${esc(CONDITION_SHORT[game.condition] ?? '—')}</span>
        ${game.platform ? `<span>·</span><span>${esc(game.platform)}</span>` : ''}
      </p>
      <div class="card-parts">${partChips(game)}</div>
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
function openScanModal({ onDetect } = {}) {
  let ferme = false;
  let detecteur = null;
  let detecteurPromesse = null;

  /*
   * Le decodeur pese 350 Ko et occupe un worker : il n'est mis en route qu'a
   * la premiere photo, et rendu des la fermeture de la modale.
   */
  const obtenirLecteur = () => {
    detecteurPromesse ??= createBarcodeDetector().then((lecteur) => {
      if (ferme) {
        lecteur.close();
        return null;
      }
      detecteur = lecteur;
      return lecteur;
    });
    return detecteurPromesse;
  };

  const modal = openModal('tpl-scan-modal', {
    onClose: () => {
      ferme = true;
      detecteur?.close();
      detecteur = null;
    },
  });
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
   * La prise de vue est confiee a l'appareil photo du systeme. Il dispose de
   * ce que le navigateur ne sait pas exploiter d'un flux video : mise au
   * point macro, stabilisation, pleine definition. Le code y occupe dix fois
   * plus de pixels, et rien n'a besoin d'etre net au bon millieme de seconde.
   *
   * Techniquement, ce n'est qu'un champ de fichier : aucune permission n'est
   * demandee, et cela fonctionne en HTTP simple — la ou l'acces direct a la
   * camera est refuse faute de connexion securisee.
   */
  const champPhoto = modal.$('#scan-photo');
  if (typeof createImageBitmap !== 'function') {
    champPhoto.disabled = true;
    modal.$('.scan-photo-btn').hidden = true;
    status.textContent =
      "Ce navigateur ne sait pas lire une photo. Saisissez le code à la main.";
    return;
  }

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
 * Demande confirmation avant de retirer un jeu.
 *
 * La reference reprend ce qui distingue deux exemplaires voisins — plateforme,
 * region, numero de serie : dans une collection qui contient plusieurs
 * editions d'un meme titre, c'est la seule chose qui permet de savoir lequel
 * va disparaitre.
 */
function confirmerSuppression(game) {
  return confirmDialog(
    'Ce jeu sera retiré de la collection. Vous pourrez annuler pendant quelques secondes.',
    {
      title: 'Supprimer ce jeu ?',
      confirmLabel: 'Supprimer',
      danger: true,
      cible: {
        nom: game.title,
        reference: [game.platform, game.region, game.serial].filter(Boolean).join(' · '),
      },
    },
  );
}

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
    : coverGeneree(game.title);

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
    const ok = await confirmerSuppression(game);
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
      const ok = await confirmerSuppression(game);
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
        'Toute la collection actuelle sera effacée avant l’import. '
        + 'Contrairement à la suppression d’un jeu, ceci ne peut pas être annulé.',
        {
          title: 'Remplacer toute la collection ?',
          confirmLabel: 'Tout remplacer',
          danger: true,
          cible: {
            nom: `${fmtNumber(state.meta?.totals?.total ?? 0)} jeux seront supprimés`,
            reference: file.name,
          },
        },
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

  // Visuel introuvable : on retombe sur la jaquette fabriquee.
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
      if (img.classList.contains('cover-fond')) {
        img.remove();
        return;
      }
      img.outerHTML = coverGeneree(img.dataset.titre || '');
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

  // Raccourci de l'ecran d'accueil : l'application s'ouvre directement sur
  // la recherche par code-barres, sans passer par la collection.
  if (new URLSearchParams(window.location.search).get('action') === 'scan') {
    writeUrl();
    openScanModal();
  }
}

init();
