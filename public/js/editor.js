/*
 * Formulaire d'un jeu : ajout et modification.
 *
 * Cataloguer une etagere, c'est enchainer des jeux de la meme plateforme, de
 * la meme region et souvent du meme etat : ces trois valeurs sont reprises
 * d'une saisie a l'autre, et « Enregistrer et suivant » garde le formulaire
 * ouvert. Pendant la frappe, le formulaire signale un jeu deja present —
 * meme titre, ou meme code-barres.
 */

import { api } from './api.js';
import { $$, esc, icon, openSheet, toast, store, debounce } from './ui.js';
import {
  createGame, patchGame, knownValues, similarTitles, findByEan,
  CONDITIONS, CONDITION_SHORT, CONDITION_LABELS, PARTS,
} from './data.js';
import { condVar } from './views.js';
import { actions } from './actions.js';
import { removeGame } from './detail.js';

const PART_ICONS = { has_box: 'box', has_cover_art: 'cover', has_manual: 'manual', has_disc: 'disc' };
const REGIONS = ['PAL', 'JAP', 'NTSC-U', 'NTSC-J'];

const pillRow = (name, values, current) => values.map((v) => `
  <button type="button" class="pill" data-pill="${name}" data-value="${esc(v)}" aria-pressed="${v === current}">${esc(v)}</button>`).join('');

function formMarkup(game, values) {
  const platforms = knownValues('platform');
  const regions = [...new Set([...REGIONS, ...knownValues('region')])];
  const flag = (key, fallback) => (values[key] === undefined ? fallback : Boolean(Number(values[key])));
  return `
  <form class="sheet-wrap" novalidate>
    <div class="sheet-head">
      <h2 class="sheet-title">${game ? 'Modifier la fiche' : 'Ajouter un jeu'}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Fermer">${icon('close')}</button>
    </div>
    <div class="sheet-body">
      ${!game && actions.instance.identify ? `<div class="id-launch">
        <button type="button" class="btn btn--block" data-identify>${icon('camera')}Photographier le jeu</button>
        <span class="hint">Face avant, dos ou disque : Claude reconnaît le jeu et propose la fiche, que vous validez avant qu’elle ne soit remplie.</span>
      </div>` : ''}
      <div class="form-grid">
        <div class="field field--full">
          <label for="f-title">Titre</label>
          <div class="field-row">
            <input class="input" id="f-title" name="title" required maxlength="200" autocomplete="off"
              enterkeyhint="next" value="${esc(values.title ?? '')}">
            ${actions.instance.externalSearch ? `<button type="button" class="btn" data-lookup title="Chercher la fiche en ligne">${icon('globe')}<span>En ligne</span></button>` : ''}
          </div>
          <div data-dupes></div>
          <div data-lookup-results></div>
        </div>

        <div class="field">
          <label for="f-platform">Plateforme</label>
          <input class="input" id="f-platform" name="platform" list="dl-platforms" autocomplete="off"
            placeholder="PS2, Switch, N64…" value="${esc(values.platform ?? '')}">
          <datalist id="dl-platforms">${platforms.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>
          ${platforms.length ? `<div class="pills">${pillRow('platform', platforms.slice(0, 8), values.platform)}</div>` : ''}
        </div>

        <div class="field">
          <label for="f-region">Région</label>
          <input class="input" id="f-region" name="region" autocomplete="off" placeholder="PAL, JAP, NTSC-U…"
            value="${esc(values.region ?? '')}">
          <div class="pills">${pillRow('region', regions.slice(0, 6), values.region)}</div>
        </div>

        <div class="field field--full">
          <span class="field-label" id="f-cond-label">État</span>
          <div class="scale" role="radiogroup" aria-labelledby="f-cond-label">${CONDITIONS.map((c) => `
            <button type="button" class="scale-step" role="radio" data-cond="${c}" style="${condVar(c)}"
              aria-checked="${values.condition === c}" title="${esc(CONDITION_LABELS[c])}">${esc(CONDITION_SHORT[c])}</button>`).join('')}
          </div>
        </div>

        <div class="field field--full">
          <span class="field-label">Contenu de la boîte</span>
          <div class="parts-grid">${PARTS.map((part) => `
            <button type="button" class="toggle" data-flag="${part.key}" aria-pressed="${flag(part.key, true)}">
              ${icon(PART_ICONS[part.key])}<span>${esc(part.label)}</span>
              <span class="toggle-state">${flag(part.key, true) ? 'Présent' : 'Manque'}</span>
            </button>`).join('')}
          </div>
          <span class="hint">Touchez ce qui manque : le jeu rejoindra la vue « Incomplets ».</span>
        </div>

        <div class="field">
          <span class="field-label">Sauvegarde et favori</span>
          <div class="parts-grid">
            <button type="button" class="toggle toggle--plain" data-flag="has_iso" aria-pressed="${flag('has_iso', false)}">
              ${icon('iso')}<span>ISO</span><span class="toggle-state">${flag('has_iso', false) ? 'Oui' : 'Non'}</span>
            </button>
            <button type="button" class="toggle toggle--plain" data-flag="favorite" aria-pressed="${flag('favorite', false)}">
              ${icon('star')}<span>Favori</span><span class="toggle-state">${flag('favorite', false) ? 'Oui' : 'Non'}</span>
            </button>
          </div>
        </div>

        <div class="field">
          <label for="f-quantity">Exemplaires</label>
          <div class="stepper">
            <button type="button" data-step="-1" aria-label="Un exemplaire de moins">${icon('minus')}</button>
            <input id="f-quantity" name="quantity" type="number" inputmode="numeric" min="1" max="9999" value="${esc(values.quantity ?? 1)}">
            <button type="button" data-step="1" aria-label="Un exemplaire de plus">${icon('plus')}</button>
          </div>
        </div>

        <div class="field">
          <label for="f-serial">Serial</label>
          <input class="input mono" id="f-serial" name="serial" autocomplete="off" autocapitalize="characters"
            placeholder="SLES52237" value="${esc(values.serial ?? '')}">
        </div>

        <div class="field">
          <label for="f-ean">Code-barres</label>
          <div class="field-row">
            <input class="input mono" id="f-ean" name="ean" inputmode="numeric" maxlength="14" autocomplete="off"
              placeholder="13 chiffres" value="${esc(values.ean ?? '')}">
            <button type="button" class="btn btn--icon" data-scan-ean aria-label="Photographier le code-barres" title="Photographier le code-barres">${icon('scan')}</button>
          </div>
        </div>

        <div class="field field--full">
          <span class="field-label">Jaquette</span>
          <div class="cover-picker">
            <div class="cover-preview" data-preview>Aucune image</div>
            <div>
              <input class="input" id="f-cover" name="cover_url" autocomplete="off" inputmode="url"
                placeholder="Adresse d’une image (https://…)" aria-label="Adresse de la jaquette" value="${esc(values.cover_url ?? '')}">
              <div class="cover-actions">
                <button type="button" class="btn" data-upload>${icon('upload')}Choisir un fichier</button>
                <button type="button" class="btn btn--ghost" data-clear-cover>Retirer</button>
              </div>
              <input type="file" accept="image/*" data-file hidden>
            </div>
          </div>
        </div>

        <div class="field field--full">
          <label for="f-tags">Tags</label>
          <input class="input" id="f-tags" name="tags" autocomplete="off" placeholder="collector, à revendre, coop — séparés par des virgules"
            value="${esc(values.tags ?? '')}">
        </div>

        <div class="field field--full">
          <label for="f-notes">Notes</label>
          <textarea class="textarea" id="f-notes" name="notes" maxlength="8000"
            placeholder="Où il est rangé, défauts de la boîte, provenance…">${esc(values.notes ?? '')}</textarea>
        </div>
      </div>
      <div data-error style="margin-top:16px"></div>
    </div>
    <div class="sheet-foot">
      ${game ? `<button type="button" class="btn btn--ghost btn--danger" data-delete>${icon('trash')}<span>Supprimer</span></button>` : ''}
      <span class="spacer"></span>
      ${game ? '' : '<button type="button" class="btn" data-save-next title="Garde la plateforme, la région et l’état pour le jeu suivant">Enregistrer et suivant</button>'}
      <button type="submit" class="btn btn--primary" data-save>Enregistrer</button>
    </div>
  </form>`;
}

/**
 * Ouvre le formulaire. `game` absent : ajout, pre-rempli avec `prefill` et
 * le contexte de la derniere saisie.
 */
export function openEditor(game = null, prefill = {}, { from = null } = {}) {
  const values = game
    ? { ...game }
    : {
      platform: store.get('gv-last-platform') || '',
      region: store.get('gv-last-region') || '',
      condition: store.get('gv-last-condition') || '',
      ...prefill,
    };

  const options = {
    className: 'sheet--editor',
    label: game ? `Modifier ${game.title}` : 'Ajouter un jeu',
    content: formMarkup(game, values),
    // Sur ordinateur, on peut taper tout de suite. Sur telephone, ouvrir le
    // clavier d'office recouvrirait la moitie du formulaire.
    focus: window.matchMedia('(pointer: fine)').matches ? '#f-title' : null,
  };
  const sheet = from ? from.swap(options) : openSheet(options);
  const form = sheet.$('form');
  const field = (name) => form.elements[name];

  /* --- Etat des boutons ------------------------------------------------- */

  const flags = {};
  for (const button of $$('[data-flag]', form)) {
    flags[button.dataset.flag] = button.getAttribute('aria-pressed') === 'true';
  }
  let condition = values.condition || '';

  const paintFlag = (button) => {
    const on = flags[button.dataset.flag];
    button.setAttribute('aria-pressed', String(on));
    const plain = button.classList.contains('toggle--plain');
    button.querySelector('.toggle-state').textContent = plain ? (on ? 'Oui' : 'Non') : (on ? 'Présent' : 'Manque');
  };
  const paintScale = () => {
    for (const step of $$('[data-cond]', form)) step.setAttribute('aria-checked', String(step.dataset.cond === condition));
  };
  const paintPills = (name) => {
    const value = field(name).value.trim();
    for (const pill of $$(`[data-pill="${name}"]`, form)) {
      pill.setAttribute('aria-pressed', String(pill.dataset.value === value));
    }
  };

  /* --- Apercu de la jaquette -------------------------------------------- */

  const preview = sheet.$('[data-preview]');
  const updatePreview = () => {
    const url = field('cover_url').value.trim();
    if (!url) {
      preview.textContent = 'Aucune image';
      return;
    }
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      preview.textContent = 'Image introuvable';
    });
    img.src = url;
    preview.replaceChildren(img);
  };
  updatePreview();
  const updatePreviewSoon = debounce(updatePreview, 350);

  /* --- Doublons ----------------------------------------------------------- */

  const dupesBox = sheet.$('[data-dupes]');
  const checkDupes = () => {
    const exclude = game?.id ?? null;
    const title = field('title').value;
    const platform = field('platform').value.trim().toLowerCase();
    const sameTitle = similarTitles(title, { threshold: 0.8, limit: 2, exclude })
      .filter((g) => !platform || !g.platform || g.platform.toLowerCase() === platform);
    const ean = field('ean').value.replace(/[\s-]/g, '');
    const sameEan = /^\d{8,14}$/.test(ean) ? findByEan(ean).filter((g) => g.id !== exclude) : [];
    const hits = [...new Map([...sameEan, ...sameTitle].map((g) => [g.id, g])).values()];
    dupesBox.innerHTML = hits.map((g) => `
      <div class="dupe" style="margin-top:8px">${icon('box', { size: 16 })}
        <span>Déjà dans la collection : <strong>${esc(g.title)}</strong>${g.platform ? ` · ${esc(g.platform)}` : ''}</span>
        <button type="button" data-see="${g.id}">Voir</button></div>`).join('');
  };
  const checkDupesSoon = debounce(checkDupes, 180);
  checkDupes();

  /* --- Evenements --------------------------------------------------------- */

  form.addEventListener('input', (event) => {
    const name = event.target.name;
    if (name === 'title' || name === 'ean' || name === 'platform') checkDupesSoon();
    if (name === 'cover_url') updatePreviewSoon();
    if (name === 'platform' || name === 'region') paintPills(name);
  });

  form.addEventListener('click', async (event) => {
    const t = event.target;
    const flagButton = t.closest('[data-flag]');
    if (flagButton) {
      flags[flagButton.dataset.flag] = !flags[flagButton.dataset.flag];
      paintFlag(flagButton);
      return;
    }
    const step = t.closest('[data-cond]');
    if (step) {
      condition = condition === step.dataset.cond ? '' : step.dataset.cond;
      paintScale();
      return;
    }
    const pill = t.closest('[data-pill]');
    if (pill) {
      const input = field(pill.dataset.pill);
      input.value = input.value.trim() === pill.dataset.value ? '' : pill.dataset.value;
      paintPills(pill.dataset.pill);
      if (pill.dataset.pill === 'platform') checkDupes();
      return;
    }
    const stepper = t.closest('[data-step]');
    if (stepper) {
      const q = field('quantity');
      q.value = String(Math.max(1, Math.min(9999, (Number(q.value) || 1) + Number(stepper.dataset.step))));
      return;
    }
    const see = t.closest('[data-see]');
    if (see) {
      actions.openDetail(Number(see.dataset.see));
      return;
    }
    if (t.closest('[data-scan-ean]')) {
      actions.openScanner({
        onCode: (code) => {
          field('ean').value = code;
          checkDupes();
        },
      });
      return;
    }
    if (t.closest('[data-upload]')) {
      sheet.$('[data-file]').click();
      return;
    }
    if (t.closest('[data-clear-cover]')) {
      field('cover_url').value = '';
      updatePreview();
      return;
    }
    if (t.closest('[data-lookup]')) {
      runLookup(sheet, form, updatePreview);
      return;
    }
    if (t.closest('[data-identify]')) {
      actions.openIdentify({
        ean: field('ean').value.replace(/[\s-]/g, ''),
        serial: field('serial').value.trim(),
        capture: true,
        onConfirm: (proposed, identifySheet) => {
          // La fiche validee l'emporte, y compris sur la plateforme et la
          // region reprises de la saisie precedente.
          for (const [name, value] of Object.entries(proposed)) {
            if (field(name)) field(name).value = value;
          }
          paintPills('platform');
          paintPills('region');
          checkDupes();
          identifySheet.close();
          toast('Fiche remplie : vérifiez-la, puis enregistrez.');
        },
      });
      return;
    }
    if (t.closest('[data-delete]')) {
      removeGame(game, sheet);
      return;
    }
    if (t.closest('[data-save-next]')) {
      save({ next: true });
    }
  });

  sheet.$('[data-file]').addEventListener('change', async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const button = sheet.$('[data-upload]');
    button.disabled = true;
    try {
      const { url } = await api.uploadCover(file);
      field('cover_url').value = url;
      updatePreview();
    } catch (err) {
      toast(`Envoi impossible : ${err.message}`, { tone: 'error' });
    } finally {
      button.disabled = false;
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });

  /* --- Enregistrement ----------------------------------------------------- */

  let saving = false;
  async function save({ next = false } = {}) {
    if (saving) return;
    const payload = {
      title: field('title').value.trim(),
      platform: field('platform').value.trim(),
      region: field('region').value.trim(),
      serial: field('serial').value.trim(),
      ean: field('ean').value.replace(/[\s-]/g, ''),
      quantity: Number(field('quantity').value) || 1,
      condition,
      cover_url: field('cover_url').value.trim(),
      tags: field('tags').value.trim(),
      notes: field('notes').value.trim(),
    };
    for (const [key, on] of Object.entries(flags)) payload[key] = on ? 1 : 0;

    const errorBox = sheet.$('[data-error]');
    errorBox.innerHTML = '';
    if (!payload.title) {
      errorBox.innerHTML = '<p class="form-error">Le titre est obligatoire.</p>';
      field('title').focus();
      return;
    }
    if (payload.ean && !/^\d{8,14}$/.test(payload.ean)) {
      errorBox.innerHTML = '<p class="form-error">Le code-barres compte de 8 à 14 chiffres.</p>';
      field('ean').focus();
      return;
    }

    saving = true;
    const buttons = $$('[data-save], [data-save-next]', form);
    buttons.forEach((b) => { b.disabled = true; });
    try {
      if (game) {
        await patchGame(game.id, payload);
        toast('Fiche enregistrée');
        actions.openDetail(game.id, { from: sheet });
        return;
      }
      const created = await createGame(payload);
      store.set('gv-last-platform', payload.platform);
      store.set('gv-last-region', payload.region);
      store.set('gv-last-condition', payload.condition);

      if (next) {
        // On ne vide que ce qui change d'un jeu a l'autre.
        for (const name of ['title', 'serial', 'ean', 'cover_url', 'tags', 'notes']) field(name).value = '';
        field('quantity').value = '1';
        for (const button of $$('[data-flag]', form)) {
          flags[button.dataset.flag] = PARTS.some((p) => p.key === button.dataset.flag);
          paintFlag(button);
        }
        updatePreview();
        sheet.$('[data-lookup-results]').innerHTML = '';
        dupesBox.innerHTML = '';
        sheet.$('.sheet-body').scrollTop = 0;
        field('title').focus();
        toast(`« ${created.title} » ajouté — au suivant`);
      } else {
        sheet.close();
        toast(`« ${created.title} » ajouté`, {
          action: { label: 'Voir', onClick: () => actions.openDetail(created.id) },
        });
      }
    } catch (err) {
      errorBox.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    } finally {
      saving = false;
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  return sheet;
}

/* -------------------------------------------------------------------------- */
/* Recherche en ligne (RAWG), si une cle est configuree                        */
/* -------------------------------------------------------------------------- */

async function runLookup(sheet, form, updatePreview) {
  const box = sheet.$('[data-lookup-results]');
  const query = form.elements.title.value.trim();
  if (query.length < 2) {
    toast('Tapez au moins deux lettres du titre.');
    return;
  }
  box.innerHTML = '<p class="hint" style="margin-top:8px">Recherche…</p>';
  try {
    const { results } = await api.searchExternal(query);
    if (!results.length) {
      box.innerHTML = '<p class="hint" style="margin-top:8px">Aucun résultat en ligne.</p>';
      return;
    }
    box.innerHTML = `<div class="suggestions">${results.map((r) => `
      <button type="button" class="suggestion" data-ext="${r.external_id}">
        ${r.cover_url ? `<img src="${esc(r.cover_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}
        <span><strong>${esc(r.title)}</strong>
        <span>${esc([r.release_year, r.platforms.slice(0, 3).join(', ')].filter(Boolean).join(' · '))}</span></span>
      </button>`).join('')}</div>`;
    box.querySelectorAll('[data-ext]').forEach((button) => {
      button.addEventListener('click', async () => {
        box.innerHTML = '<p class="hint" style="margin-top:8px">Récupération de la fiche…</p>';
        try {
          const detail = await api.externalGame(button.dataset.ext);
          if (detail.title) form.elements.title.value = detail.title;
          if (detail.cover_url) form.elements.cover_url.value = detail.cover_url;
          if (!form.elements.platform.value && detail.platforms?.length) form.elements.platform.value = detail.platforms[0];
          if (!form.elements.tags.value && detail.tags) form.elements.tags.value = detail.tags;
          updatePreview();
          box.innerHTML = '';
        } catch (err) {
          box.innerHTML = '';
          toast(err.message, { tone: 'error' });
        }
      });
    });
  } catch (err) {
    box.innerHTML = '';
    toast(err.message, { tone: 'error' });
  }
}
