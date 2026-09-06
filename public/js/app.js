import { api } from './api.js';
import {
  $, $$, esc, toast, openModal, confirmDialog, debounce, initial, store,
  CONDITION_LABELS, CONDITION_SHORT, CONDITION_COLORS, FORMAT_LABELS,
  PARTS, missingParts, fmtNumber, fmtDate,
} from './ui.js';

/* ==========================================================================
   Etat
   ========================================================================== */

const CONDITIONS = ['sealed', 'mint', 'good', 'fair', 'poor'];
const FORMATS = ['physical', 'digital'];

const state = {
  filters: {
    search: '', platform: '', condition: '', format: '',
    tag: '', favorite: '', incomplete: '',
  },
  sort: 'created_at',
  dir: 'desc',
  page: 1,
  limit: store.get('gameshelf-limit') || '60',
  view: store.get('gameshelf-view') || 'grid',
  meta: null,
  session: { externalSearch: false, user: null, authDisabled: false },
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

  const formatCounts = new Map((meta.by_format || []).map((r) => [r.label, r.count]));
  $('#filter-format').replaceChildren(
    ...FORMATS.map((key) =>
      filterButton({
        label: FORMAT_LABELS[key],
        count: formatCounts.get(key) || 0,
        active: state.filters.format === key,
        dataset: { filter: 'format', value: key },
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
  fillList('#filter-tags', meta.tags, 'tag', 12);

  // Listes de saisie assistee des formulaires.
  const fillDatalist = (id, values) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = values.map((v) => `<option value="${esc(v.value)}"></option>`).join('');
  };
  fillDatalist('dl-platforms', meta.platforms);
  fillDatalist('dl-developers', meta.developers);

  // Compteurs et etat actif des vues rapides.
  const totals = meta.totals || {};
  $('#count-all').textContent = fmtNumber(totals.total || 0);
  $('#count-fav').textContent = fmtNumber(totals.favorites || 0);
  $('#count-incomplete').textContent = fmtNumber(totals.incomplete || 0);

  const noFilter = !Object.values(state.filters).some(Boolean);
  $$('[data-quick]').forEach((btn) => {
    const quick = btn.dataset.quick;
    const active =
      quick === 'favorite' ? state.filters.favorite === '1'
        : quick === 'incomplete' ? state.filters.incomplete === '1'
          : noFilter;
    btn.classList.toggle('active', active);
  });
}

/* ==========================================================================
   Filtres actifs
   ========================================================================== */

const CHIP_LABELS = {
  search: 'Recherche',
  platform: 'Plateforme',
  condition: 'État',
  format: 'Format',
  tag: 'Tag',
  favorite: 'Favoris',
  incomplete: 'Incomplets',
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
    if (key === 'format') return FORMAT_LABELS[value] || value;
    if (key === 'favorite' || key === 'incomplete') return 'oui';
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

/**
 * Visuel d'une carte. Les images cassees sont remplacees par l'initiale du
 * titre : l'evenement `error` est capture au niveau du conteneur (voir
 * bindEvents), car un handler inline serait bloque par la CSP.
 */
function coverMarkup(game) {
  if (game.cover_url) {
    return `<img src="${esc(game.cover_url)}" alt="" loading="lazy" data-initial="${esc(initial(game.title))}">`;
  }
  return `<div class="cover-placeholder">${esc(initial(game.title))}</div>`;
}

function missingBadge(game) {
  const missing = missingParts(game);
  if (missing.length === 0) return '';
  return `<span class="missing" title="Éléments manquants : ${esc(missing.join(', '))}">
    sans ${esc(missing.join(', '))}
  </span>`;
}

function gameCard(game) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = game.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Modifier ${game.title}`);

  const meta = [game.platform, game.release_year].filter(Boolean).map(esc).join(' · ');
  const missing = missingBadge(game);

  card.innerHTML = `
    <div class="cover">
      ${coverMarkup(game)}
      ${game.quantity > 1 ? `<span class="qty-badge" title="${game.quantity} exemplaires">×${game.quantity}</span>` : ''}
      <button class="fav-btn${game.favorite ? ' on' : ''}" data-fav="${game.id}"
              title="${game.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}"
              aria-label="${game.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="${game.favorite ? 'currentColor' : 'none'}"
             stroke="currentColor" stroke-width="2" stroke-linejoin="round">
          <path d="m12 17.3-6.2 3.6 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7z"/>
        </svg>
      </button>
    </div>
    <div class="card-body">
      <div class="card-title">${esc(game.title)}</div>
      ${meta ? `<div class="card-meta">${meta}</div>` : ''}
      ${missing ? `<div class="card-meta">${missing}</div>` : ''}
      <div class="card-foot">
        <span class="badge">
          <span class="dot" style="background:${CONDITION_COLORS[game.condition] || 'var(--text-faint)'}"></span>
          ${esc(CONDITION_SHORT[game.condition] ?? game.condition)}
        </span>
        ${game.rating !== null && game.rating !== undefined ? `<span class="rating-pill">${game.rating}/10</span>` : ''}
      </div>
    </div>`;
  return card;
}

const TABLE_COLUMNS = [
  { key: 'title', label: 'Titre' },
  { key: 'platform', label: 'Plateforme' },
  { key: 'quantity', label: 'Qté' },
  { key: null, label: 'État' },
  { key: null, label: 'Format' },
  { key: null, label: 'Manque' },
  { key: 'release_year', label: 'Année' },
  { key: 'rating', label: 'Note' },
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
        <td style="font-variant-numeric:tabular-nums">${game.quantity}</td>
        <td>
          <span class="badge">
            <span class="dot" style="background:${CONDITION_COLORS[game.condition] || 'var(--text-faint)'}"></span>
            ${esc(CONDITION_SHORT[game.condition] ?? game.condition)}
          </span>
        </td>
        <td>${esc(FORMAT_LABELS[game.format] || game.format)}</td>
        <td>${missing.length ? `<span class="missing">${esc(missing.join(', '))}</span>` : '—'}</td>
        <td>${game.release_year ?? '—'}</td>
        <td>${game.rating ?? '—'}</td>
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
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

  const titles = `${fmtNumber(result.total)} titre${result.total > 1 ? 's' : ''}`;
  $('#result-count').textContent =
    result.total === 0
      ? 'Aucun jeu'
      : result.copies > result.total
        ? `${titles} · ${fmtNumber(result.copies)} exemplaires`
        : titles;

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
  showSkeleton();
  try {
    if (withMeta) await loadMeta();
    await loadGames();
  } catch (err) {
    $('#games-container').innerHTML =
      `<div class="empty"><h3>Chargement impossible</h3><p>${esc(err.message)}</p></div>`;
  }
}

/* ==========================================================================
   Scanner de codes-barres
   ========================================================================== */

const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];

/**
 * Ouvre la modale de scan. `onDetect(code)` recoit le code lu ; s'il renvoie
 * true, la modale se ferme. Sans callback, on interroge la collection.
 */
async function openScanModal({ onDetect } = {}) {
  let stopped = false;
  let stream = null;

  const stopCamera = () => {
    stopped = true;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
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

  // --- Disponibilite de la camera -------------------------------------------
  if (!window.isSecureContext) {
    status.textContent =
      'La caméra exige une connexion HTTPS (ou localhost). Saisissez le code à la main.';
    modal.$('#scanner-frame').hidden = true;
    modal.$('#scan-manual').focus();
    return;
  }
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    status.textContent =
      'Ce navigateur ne sait pas lire les codes-barres (Chrome sur Android, oui). Saisissez le code à la main.';
    modal.$('#scanner-frame').hidden = true;
    modal.$('#scan-manual').focus();
    return;
  }

  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = BARCODE_FORMATS.filter((f) => supported.includes(f));
    const detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    });
    if (stopped) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    video.srcObject = stream;
    await video.play();
    status.textContent = 'Visez le code-barres au dos du boîtier.';

    let lastCode = '';
    const tick = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        const code = codes[0]?.rawValue;
        if (code && code !== lastCode) {
          lastCode = code;
          navigator.vibrate?.(60);
          status.textContent = `Code lu : ${code}`;
          modal.$('#scan-manual').value = code;
          await handle(code);
        }
      } catch {
        /* image illisible sur cette frame : on retente */
      }
      if (!stopped) setTimeout(tick, 250);
    };
    tick();
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
      status.textContent = 'Aucune correspondance.';
      return;
    }

    status.textContent = `${data.games.length} correspondance(s).`;
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
              esc(CONDITION_SHORT[game.condition] ?? ''),
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
   Modale : fiche de jeu
   ========================================================================== */

const FORM_FIELDS = [
  ['f-title', 'title'], ['f-cover', 'cover_url'], ['f-platform', 'platform'],
  ['f-ean', 'ean'], ['f-quantity', 'quantity'], ['f-condition', 'condition'],
  ['f-format', 'format'], ['f-developer', 'developer'], ['f-publisher', 'publisher'],
  ['f-year', 'release_year'], ['f-rating', 'rating'], ['f-purchase', 'purchase_date'],
  ['f-tags', 'tags'], ['f-notes', 'notes'],
];

function openGameModal(game = null, prefill = {}) {
  const modal = openModal('tpl-game-modal');
  const isEdit = Boolean(game);

  modal.$('#game-modal-title').textContent = isEdit ? 'Modifier le jeu' : 'Ajouter un jeu';

  const coverInput = modal.$('#f-cover');
  const updatePreview = () => updateCoverPreview(modal);

  // Les elements de completude n'ont pas de sens pour un jeu dematerialise.
  const formatSelect = modal.$('#f-format');
  const syncPartsVisibility = () => {
    modal.$('#parts-block').hidden = formatSelect.value === 'digital';
  };
  formatSelect.addEventListener('change', syncPartsVisibility);

  if (isEdit) {
    for (const [id, key] of FORM_FIELDS) {
      const el = modal.$(`#${id}`);
      if (el) el.value = game[key] ?? '';
    }
    modal.$('#f-favorite').checked = Boolean(game.favorite);
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
    for (const [key, value] of Object.entries(prefill)) {
      const el = modal.$(`#f-${key}`);
      if (el) el.value = value;
    }
    if (prefill.ean) modal.$('#f-title').focus();
  }

  syncPartsVisibility();

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
  if (state.session.externalSearch) {
    const lookupButton = modal.$('#btn-lookup');
    lookupButton.hidden = false;
    lookupButton.addEventListener('click', () => runLookup(modal));
  }

  // Enregistrement
  modal.$('#game-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = { favorite: modal.$('#f-favorite').checked ? 1 : 0 };
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

    const saveButton = modal.$('#btn-save');
    saveButton.disabled = true;
    saveButton.textContent = 'Enregistrement…';
    try {
      if (isEdit) await api.updateGame(game.id, payload);
      else await api.createGame(payload);
      modal.close();
      toast(isEdit ? 'Jeu mis à jour' : 'Jeu ajouté');
      refresh({ withMeta: true });
    } catch (err) {
      toast(err.message, 'error');
      saveButton.disabled = false;
      saveButton.textContent = 'Enregistrer';
    }
  });
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
          apply('f-year', detail.release_year);
          apply('f-developer', detail.developer);
          apply('f-publisher', detail.publisher);
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
      const result = await api.importData(content, format, mode);

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
   Modale : compte
   ========================================================================== */

function openAccountModal() {
  const modal = openModal('tpl-account-modal');
  modal.$('#acc-username').textContent = state.session.user?.username || 'invité';

  if (state.session.authDisabled) {
    modal.$('#password-form').innerHTML =
      '<p style="color:var(--text-muted);font-size:14px;margin:0">L’authentification est désactivée sur cette instance (DISABLE_AUTH=1).</p>';
    modal.$('#btn-logout').hidden = true;
    return;
  }

  modal.$('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api.changePassword(modal.$('#acc-current').value, modal.$('#acc-new').value);
      toast('Mot de passe mis à jour, reconnexion nécessaire');
      setTimeout(() => { window.location.href = '/login'; }, 1200);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  modal.$('#btn-logout').addEventListener('click', async () => {
    await api.logout().catch(() => {});
    window.location.href = '/login';
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
      const placeholder = document.createElement('div');
      placeholder.className = 'cover-placeholder';
      placeholder.textContent = img.dataset.initial || '?';
      img.replaceWith(placeholder);
    },
    true,
  );

  // Grille / tableau : bascule favori, tri, ouverture d'une fiche
  $('#games-container').addEventListener('click', async (event) => {
    const favButton = event.target.closest('[data-fav]');
    if (favButton) {
      event.stopPropagation();
      try {
        const updated = await api.toggleFavorite(favButton.dataset.fav);
        favButton.classList.toggle('on', Boolean(updated.favorite));
        favButton.querySelector('svg').setAttribute('fill', updated.favorite ? 'currentColor' : 'none');
        loadMeta();
        if (state.filters.favorite === '1') refresh();
      } catch (err) {
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
  $('#btn-add').addEventListener('click', () => openGameModal());
  $('#btn-io').addEventListener('click', openIoModal);
  $('#btn-account').addEventListener('click', openAccountModal);
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
    openGameModal(await api.get(`/api/games/${id}`));
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
    state.session = await api.me();
    if (!state.session.authenticated && !state.session.authDisabled) {
      window.location.href = '/login';
      return;
    }
  } catch {
    /* on continue : les appels suivants signaleront le probleme */
  }

  await refresh({ withMeta: true });
}

init();
