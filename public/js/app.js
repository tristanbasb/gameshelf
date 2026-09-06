import { api } from './api.js';
import {
  $, $$, esc, toast, openModal, confirmDialog, debounce, initial,
  CONDITION_LABELS, CONDITION_SHORT, CONDITION_COLORS, FORMAT_LABELS, store,
  fmtNumber, fmtMoney, fmtDate,
} from './ui.js';

/* ==========================================================================
   Etat
   ========================================================================== */

const CONDITIONS = ['sealed', 'mint', 'good', 'fair', 'poor'];
const FORMATS = ['physical', 'digital'];

const state = {
  filters: { search: '', platform: '', condition: '', format: '', tag: '', favorite: '' },
  sort: 'created_at',
  dir: 'desc',
  page: 1,
  limit: 60,
  view: store.get('gameshelf-view') || 'grid',
  screen: 'collection',
  meta: null,
  counts: { conditions: [], formats: [] },
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
  state.screen = params.get('screen') === 'stats' ? 'stats' : 'collection';
}

function writeUrl() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) {
    if (value) params.set(key, value);
  }
  if (state.sort !== 'created_at') params.set('sort', state.sort);
  if (state.dir !== 'desc') params.set('dir', state.dir);
  if (state.page > 1) params.set('page', String(state.page));
  if (state.screen === 'stats') params.set('screen', 'stats');

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
  const conditionCounts = new Map(state.counts.conditions.map((row) => [row.label, row.count]));
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

  const formatCounts = new Map(state.counts.formats.map((row) => [row.label, row.count]));
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

  // Etat actif des raccourcis "Tous" / "Favoris".
  const noFilter = !Object.values(state.filters).some(Boolean);
  $$('[data-quick]').forEach((btn) => {
    const isFav = btn.dataset.quick === 'favorite';
    btn.classList.toggle('active', isFav ? state.filters.favorite === '1' : noFilter);
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
    if (key === 'favorite') return 'oui';
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
 * Jaquette d'une carte. Les images cassees sont remplacees par l'initiale du
 * titre : l'evenement `error` est capture au niveau du conteneur (voir
 * bindEvents), car un handler inline serait bloque par la CSP.
 */
function coverMarkup(game) {
  if (game.cover_url) {
    return `<img src="${esc(game.cover_url)}" alt="" loading="lazy" data-initial="${esc(initial(game.title))}">`;
  }
  return `<div class="cover-placeholder">${esc(initial(game.title))}</div>`;
}

function gameCard(game) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = game.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Modifier ${game.title}`);

  const meta = [game.platform, game.release_year].filter(Boolean).map(esc).join(' · ');

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
  { key: 'release_year', label: 'Année' },
  { key: 'rating', label: 'Note' },
  { key: 'price', label: 'Prix' },
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
    .map(
      (game) => `
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
        <td>${game.release_year ?? '—'}</td>
        <td>${game.rating ?? '—'}</td>
        <td>${game.price !== null && game.price !== undefined ? esc(fmtMoney(game.price)) : '—'}</td>
        <td>${esc(fmtDate(game.created_at))}</td>
      </tr>`,
    )
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
  const [meta, stats] = await Promise.all([api.meta(), api.stats()]);
  state.meta = meta;
  state.counts.conditions = stats.by_condition;
  state.counts.formats = stats.by_format;
  $('#count-all').textContent = fmtNumber(stats.total);
  $('#count-fav').textContent = fmtNumber(stats.favorites || 0);
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
   Modale : fiche de jeu
   ========================================================================== */

const FORM_FIELDS = [
  ['f-title', 'title'], ['f-cover', 'cover_url'], ['f-platform', 'platform'],
  ['f-quantity', 'quantity'], ['f-condition', 'condition'], ['f-format', 'format'],
  ['f-developer', 'developer'], ['f-publisher', 'publisher'], ['f-year', 'release_year'],
  ['f-rating', 'rating'], ['f-price', 'price'], ['f-purchase', 'purchase_date'],
  ['f-tags', 'tags'], ['f-notes', 'notes'],
];

function openGameModal(game = null) {
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
  }

  coverInput.addEventListener('input', debounce(updatePreview, 400));
  modal.$('#btn-clear-cover').addEventListener('click', () => {
    coverInput.value = '';
    updatePreview();
  });

  // Televersement d'une jaquette
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
      toast('Jaquette téléversée');
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

/** Affiche la jaquette courante du formulaire dans l'encadre d'apercu. */
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
   Statistiques
   ========================================================================== */

function barList(rows, total) {
  if (!rows.length) return '<p style="color:var(--text-faint);font-size:13px">Aucune donnée</p>';
  const max = Math.max(...rows.map((r) => r.count), 1);
  return rows
    .map(
      (row) => `
      <div class="bar-row">
        <div class="bar-label">
          <span class="name">${esc(row.label)}</span>
          <span class="n">${fmtNumber(row.count)}${total ? ` · ${Math.round((row.count / total) * 100)}%` : ''}</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${(row.count / max) * 100}%"></div></div>
      </div>`,
    )
    .join('');
}

async function renderStats() {
  const box = $('#stats-content');
  box.innerHTML = '<div class="skeleton" style="height:120px;aspect-ratio:auto"></div>';

  try {
    const stats = await api.stats();

    const cards = [
      { label: 'Titres différents', value: fmtNumber(stats.total), sub: 'jeux distincts' },
      { label: 'Exemplaires', value: fmtNumber(stats.copies), sub: `dont ${fmtNumber(stats.duplicates || 0)} titre(s) en plusieurs exemplaires` },
      { label: 'Plateformes', value: fmtNumber(stats.platform_count || 0), sub: 'supports représentés' },
      { label: 'Valeur d’achat', value: fmtMoney(stats.total_spent), sub: 'somme des prix renseignés' },
      { label: 'Favoris', value: fmtNumber(stats.favorites || 0), sub: 'jeux marqués' },
      {
        label: 'Note moyenne',
        value: stats.rated_count
          ? `${(Math.round(stats.avg_rating * 10) / 10).toString().replace('.', ',')}/10`
          : '—',
        sub: `${fmtNumber(stats.rated_count)} jeu(x) noté(s)`,
      },
    ];

    const label = (dict, key) => dict[key] ?? key;
    const conditionRows = (stats.by_condition || []).map((row) => ({
      label: label(CONDITION_LABELS, row.label),
      count: row.count,
    }));
    const formatRows = (stats.by_format || []).map((row) => ({
      label: label(FORMAT_LABELS, row.label),
      count: row.count,
    }));

    box.innerHTML = `
      <div class="stat-cards">
        ${cards.map((card) => `
          <div class="stat-card">
            <div class="label">${esc(card.label)}</div>
            <div class="value">${esc(card.value)}</div>
            <div class="sub">${esc(card.sub)}</div>
          </div>`).join('')}
      </div>

      <div class="panels">
        <div class="panel"><h3>Par plateforme</h3>${barList(stats.by_platform.slice(0, 14), stats.total)}</div>
        <div class="panel"><h3>Par état</h3>${barList(conditionRows, stats.total)}</div>
        <div class="panel"><h3>Par format</h3>${barList(formatRows, stats.total)}</div>
        <div class="panel">
          <h3>Plusieurs exemplaires</h3>
          <div class="rank-list">
            ${stats.most_copies.length
              ? stats.most_copies.map((game) => `
                  <div class="rank-item" data-open="${game.id}">
                    <span class="t">${esc(game.title)}</span>
                    <span class="v">×${game.quantity}</span>
                  </div>`).join('')
              : '<p style="color:var(--text-faint);font-size:13px">Aucun doublon</p>'}
          </div>
        </div>
        <div class="panel">
          <h3>Mieux notés</h3>
          <div class="rank-list">
            ${stats.top_rated.length
              ? stats.top_rated.map((game, index) => `
                  <div class="rank-item" data-open="${game.id}">
                    <span class="idx">${index + 1}</span>
                    <span class="t">${esc(game.title)}</span>
                    <span class="v">${game.rating}</span>
                  </div>`).join('')
              : '<p style="color:var(--text-faint);font-size:13px">Aucun jeu noté</p>'}
          </div>
        </div>
        <div class="panel">
          <h3>Ajouts récents</h3>
          <div class="rank-list">
            ${stats.recent.length
              ? stats.recent.map((game) => `
                  <div class="rank-item" data-open="${game.id}">
                    <span class="t">${esc(game.title)}</span>
                    <span style="color:var(--text-faint);font-size:12px">${esc(fmtDate(game.created_at))}</span>
                  </div>`).join('')
              : '<p style="color:var(--text-faint);font-size:13px">Rien pour le moment</p>'}
          </div>
        </div>
        ${stats.by_year.length
          ? `<div class="panel" style="grid-column:1/-1"><h3>Par année de sortie</h3>${
              barList(stats.by_year.map((r) => ({ label: String(r.label), count: r.count })), stats.total)
            }</div>`
          : ''}
      </div>`;
  } catch (err) {
    box.innerHTML = `<div class="empty"><h3>Statistiques indisponibles</h3><p>${esc(err.message)}</p></div>`;
  }
}

function showScreen(screen) {
  state.screen = screen;
  $('#view-collection').hidden = screen !== 'collection';
  $('#view-stats').hidden = screen !== 'stats';
  writeUrl();
  if (screen === 'stats') renderStats();
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

  // Jaquette introuvable : on retombe sur l'initiale du titre.
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

  // Ouverture depuis les classements de la page statistiques
  $('#stats-content').addEventListener('click', (event) => {
    const item = event.target.closest('[data-open]');
    if (item) openGame(item.dataset.open);
  });

  // Tri
  $('#sort').addEventListener('change', (event) => {
    const [sort, dir] = event.target.value.split(':');
    state.sort = sort;
    state.dir = dir;
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
  $('#btn-add').addEventListener('click', () => openGameModal());
  $('#btn-io').addEventListener('click', openIoModal);
  $('#btn-account').addEventListener('click', openAccountModal);
  $('#btn-stats').addEventListener('click', () => showScreen('stats'));
  $('#btn-back-collection').addEventListener('click', () => showScreen('collection'));
  $('#brand-home').addEventListener('click', (event) => {
    event.preventDefault();
    showScreen('collection');
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

    if (event.key === '/' && !typing) {
      event.preventDefault();
      $('#search').focus();
    } else if ((event.key === 'n' || event.key === 'N') && !typing && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      openGameModal();
    } else if (event.key === 'Escape' && typing && event.target.id === 'search') {
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
    showScreen(state.screen);
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

  showScreen(state.screen);
  await refresh({ withMeta: true });
}

init();
