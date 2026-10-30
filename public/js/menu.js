/*
 * Menu « Plus » : modeles Claude, theme, import et export, a propos.
 */

import { api } from './api.js';
import { esc, icon, openSheet, toast, store, confirmSheet, fmtNumber } from './ui.js';
import { collection, sync, EMPTY_FILTERS } from './data.js';
import { actions } from './actions.js';

/* -------------------------------------------------------------------------- */
/* Theme                                                                      */
/* -------------------------------------------------------------------------- */

const THEMES = [
  { key: 'dark', label: 'Sombre', icon: 'moon' },
  { key: 'black', label: 'Noir', icon: 'black' },
  { key: 'light', label: 'Clair', icon: 'sun' },
  { key: 'auto', label: 'Système', icon: 'auto' },
];

const SYSTEM_BAR = { dark: '#090d1f', black: '#000000', light: '#eef1f8' };
const systemLight = window.matchMedia?.('(prefers-color-scheme: light)');

export function applyTheme(choice) {
  const theme = choice === 'auto' ? (systemLight?.matches ? 'light' : 'dark') : choice;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeChoice = choice;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SYSTEM_BAR[theme]);
}

systemLight?.addEventListener?.('change', () => {
  if ((store.get('gv-theme') || 'auto') === 'auto') applyTheme('auto');
});
applyTheme(store.get('gv-theme') || 'auto');

/* -------------------------------------------------------------------------- */
/* Menu                                                                       */
/* -------------------------------------------------------------------------- */

const USAGES = [
  { key: 'identify', label: 'Identifier un jeu', saved: 'Identification' },
  { key: 'chat', label: 'Discussion', saved: 'Discussion, dès la prochaine conversation' },
];

/* Un modele par usage : on peut identifier avec Opus et discuter avec Haiku. */
function modelsMarkup(models) {
  return `<h3 class="section-label" style="margin-top:22px">Modèles Claude</h3>
    <div class="form-grid">${USAGES.map((u) => `
      <div class="field">
        <label for="model-${u.key}">${esc(u.label)}</label>
        <span class="select"><select id="model-${u.key}" data-model="${u.key}">${models.choices.map((m) => `
          <option value="${esc(m.id)}"${m.id === models[u.key] ? ' selected' : ''}>${esc(m.name.replace(/^Claude /, ''))} · ${esc(m.price)}</option>`).join('')}
        </select></span>
      </div>`).join('')}
    </div>
    <p class="hint" style="margin-top:10px">Prix par million de jetons, lus / écrits. Une conversation garde le modèle avec lequel elle a commencé : le crayon en ouvre une nouvelle.</p>`;
}

export function openMenu() {
  const choice = store.get('gv-theme') || 'auto';
  const { version, secure, chat, models } = actions.instance;
  const saved = collection.savedAt ? new Date(collection.savedAt).toLocaleString('fr-FR') : '';

  const sheet = openSheet({
    className: 'sheet--menu',
    label: 'Plus d’options',
    content: `<div class="sheet-wrap">
      <div class="sheet-head">
        <h2 class="sheet-title">Plus</h2>
        <button type="button" class="icon-btn" data-close aria-label="Fermer">${icon('close')}</button>
      </div>
      <div class="sheet-body">
        <div class="menu-list">
          ${chat
            ? `<button type="button" class="menu-item" data-go="chat">${icon('chat', { size: 22 })}
              <span><strong>Discuter avec Claude</strong><span>Questions sur la collection, cotes, éditions</span></span></button>`
            // Sans cle, la fonction ne disparait pas sans laisser de trace :
            // on dit ce qui manque pour l'activer.
            : `<div class="menu-item is-off">${icon('chat', { size: 22 })}
              <span><strong>Claude : inactif</strong><span>Pour discuter avec Claude et identifier un jeu en photo, renseignez ANTHROPIC_API_KEY dans le fichier .env du serveur, puis redémarrez-le.</span></span></div>`}
          <button type="button" class="menu-item" data-go="transfer">${icon('transfer', { size: 22 })}
            <span><strong>Import et export</strong><span>CSV, JSON, sauvegarde complète de la base</span></span></button>
          <button type="button" class="menu-item" data-go="stats">${icon('chart', { size: 22 })}
            <span><strong>Bilan de la collection</strong><span>Plateformes, état, boîtes complètes</span></span></button>
          <button type="button" class="menu-item" data-go="refresh">${icon('home', { size: 22 })}
            <span><strong>Relire la collection</strong><span>Récupère les changements faits sur un autre appareil</span></span></button>
          ${secure ? '' : `<a class="menu-item" href="/cert.pem" download>${icon('scan', { size: 22 })}
            <span><strong>Certificat du serveur</strong><span>À installer sur le téléphone pour autoriser l’appareil photo</span></span></a>`}
        </div>
        ${models ? modelsMarkup(models) : ''}

        <h3 class="section-label" style="margin-top:22px">Thème</h3>
        <div class="theme-choice" role="radiogroup" aria-label="Thème">${THEMES.map((t) => `
          <button type="button" role="radio" data-theme-choice="${t.key}" aria-checked="${t.key === choice}">
            ${icon(t.icon, { size: 20 })}${esc(t.label)}</button>`).join('')}
        </div>

        <p class="about">
          GameVault${version ? ` ${esc(version)}` : ''} · ${fmtNumber(collection.byId.size)} jeux<br>
          ${collection.live ? 'Collection à jour avec le serveur.' : `Copie locale${saved ? ` du ${esc(saved)}` : ''} : consultation et scan uniquement.`}<br>
          Raccourcis : / ou Ctrl+K recherche · S scanner · N ajouter${chat ? ' · C Claude' : ''}
        </p>
      </div></div>`,
  });

  sheet.el.addEventListener('click', async (event) => {
    // Le bouton seul : <html> porte aussi data-theme-choice (voir theme.js),
    // et tout clic du menu y remonterait.
    const themeButton = event.target.closest('button[data-theme-choice]');
    if (themeButton) {
      const key = themeButton.dataset.themeChoice;
      store.set('gv-theme', key);
      applyTheme(key);
      sheet.el.querySelectorAll('[data-theme-choice]').forEach((b) => {
        b.setAttribute('aria-checked', String(b.dataset.themeChoice === key));
      });
      return;
    }
    const go = event.target.closest('[data-go]')?.dataset.go;
    if (go === 'chat') actions.openChat();
    else if (go === 'transfer') openTransfer({ from: sheet });
    else if (go === 'stats') actions.openStats();
    else if (go === 'refresh') {
      try {
        const changed = await sync();
        toast(changed ? 'Collection mise à jour' : 'La collection était déjà à jour');
        sheet.close();
      } catch (err) {
        toast(`Serveur injoignable : ${err.message}`, { tone: 'error' });
      }
    }
  });

  sheet.el.addEventListener('change', async (event) => {
    const select = event.target.closest('select[data-model]');
    if (!select) return;
    const usage = USAGES.find((u) => u.key === select.dataset.model);
    select.disabled = true;
    try {
      Object.assign(models, await api.setModels({ [usage.key]: select.value }));
      const name = models.choices.find((m) => m.id === models[usage.key])?.name;
      toast(`${usage.saved} : ${name}`);
    } catch (err) {
      select.value = models[usage.key];
      toast(`Modèle non enregistré : ${err.message}`, { tone: 'error' });
    } finally {
      select.disabled = false;
    }
  });
  return sheet;
}

/* -------------------------------------------------------------------------- */
/* Import et export                                                           */
/* -------------------------------------------------------------------------- */

const FILTER_LABELS = {
  q: 'recherche', platform: 'plateforme', region: 'région', condition: 'état', tag: 'tag',
  favorite: 'favoris', incomplete: 'incomplets', iso: 'ISO',
};

/** Filtres de l'adresse, traduits pour l'export (qui reprend ce qu'on voit). */
function currentExportQuery() {
  const params = new URLSearchParams(window.location.search);
  const out = new URLSearchParams();
  const active = [];
  for (const key of Object.keys(EMPTY_FILTERS)) {
    const value = params.get(key);
    if (!value) continue;
    active.push(FILTER_LABELS[key]);
    if (key === 'q') out.set('search', value);
    else if (key === 'condition') out.set('condition', value === '-' ? '' : value);
    else out.set(key, value);
  }
  return { query: out.toString(), active };
}

export function openTransfer({ from = null } = {}) {
  const { query, active } = currentExportQuery();
  const suffix = query ? `&${query}` : '';
  const options = {
    className: 'sheet--transfer',
    label: 'Import et export',
    content: `<div class="sheet-wrap">
      <div class="sheet-head">
        <h2 class="sheet-title">Import et export</h2>
        <button type="button" class="icon-btn" data-close aria-label="Fermer">${icon('close')}</button>
      </div>
      <div class="sheet-body">
        <section class="block">
          <h3 class="section-label">Exporter</h3>
          <p class="hint">${active.length
            ? `Seuls les jeux affichés sont exportés (filtres : ${esc(active.join(', '))}).`
            : 'Toute la collection.'}</p>
          <div class="cover-actions">
            <a class="btn" href="/api/export?format=csv${esc(suffix)}" download>Fichier CSV</a>
            <a class="btn" href="/api/export?format=json${esc(suffix)}" download>Fichier JSON</a>
            <a class="btn" href="/api/backup" download title="Copie complète de la base SQLite">Sauvegarde .db</a>
          </div>
        </section>

        <section class="block">
          <h3 class="section-label">Importer</h3>
          <p class="hint">Fichier CSV ou JSON. La première ligne d’un CSV donne les en-têtes : titre, plateforme, région, état, serial, ean, quantité, complet, iso, favori, tags, notes.</p>
          <div class="form-grid" style="margin-top:14px">
            <div class="field field--full">
              <label for="imp-file">Fichier</label>
              <input class="input" type="file" id="imp-file" accept=".csv,.json,text/csv,application/json">
            </div>
            <div class="field">
              <label for="imp-platform">Plateforme par défaut</label>
              <input class="input" id="imp-platform" autocomplete="off" placeholder="Pour un fichier d’une seule console">
            </div>
            <div class="field">
              <label for="imp-mode">Mode</label>
              <span class="select"><select id="imp-mode">
                <option value="merge">Ajouter (ignore les doublons)</option>
                <option value="replace">Remplacer toute la collection</option>
              </select></span>
            </div>
          </div>
          <div data-report style="margin-top:14px"></div>
        </section>
      </div>
      <div class="sheet-foot">
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Fermer</button>
        <button type="button" class="btn btn--primary" data-import>Importer</button>
      </div></div>`,
  };
  const sheet = from ? from.swap(options) : openSheet(options);
  const report = sheet.$('[data-report]');

  sheet.$('[data-import]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const file = sheet.$('#imp-file').files?.[0];
    if (!file) {
      report.innerHTML = '<p class="form-error">Choisissez d’abord un fichier.</p>';
      return;
    }
    const mode = sheet.$('#imp-mode').value;
    if (mode === 'replace') {
      const ok = await confirmSheet({
        title: 'Remplacer toute la collection ?',
        message: 'La collection actuelle sera effacée avant l’import. Une copie de la base est mise de côté dans data/backups, mais l’opération ne s’annule pas depuis l’interface.',
        confirmLabel: 'Tout remplacer',
        danger: true,
        subject: { name: `${fmtNumber(collection.byId.size)} jeux remplacés`, ref: file.name },
      });
      if (!ok) return;
    }
    button.disabled = true;
    button.textContent = 'Import en cours…';
    try {
      const content = await file.text();
      const format = /\.json$/i.test(file.name) ? 'json' : 'csv';
      const result = await api.importData(content, format, mode, sheet.$('#imp-platform').value.trim());
      report.innerHTML = `<div class="dupe" style="border-color:var(--ok)">
        <span><strong>${fmtNumber(result.imported)} jeu(x) importé(s)</strong>, ${fmtNumber(result.skipped)} doublon(s) ignoré(s),
        ${fmtNumber(result.invalid)} ligne(s) invalide(s).${result.backup ? ` Ancienne collection copiée dans <code>data/backups/${esc(result.backup)}</code>.` : ''}</span></div>
        ${result.details?.length ? `<details style="margin-top:8px"><summary>Lignes ignorées</summary><ul>${result.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details>` : ''}`;
      await sync();
    } catch (err) {
      report.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    } finally {
      button.disabled = false;
      button.textContent = 'Importer';
    }
  });
  return sheet;
}
