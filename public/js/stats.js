/*
 * Bilan de la collection.
 *
 * Le premier chiffre est une longueur : ce que la collection occupe sur une
 * etagere, boitier par boitier. C'est la mesure qu'un collectionneur se
 * represente — « il me faut une etagere de plus » — et elle se deduit
 * honnetement de l'epaisseur de chaque boitier.
 *
 * Chaque ligne du bilan est un filtre : la toucher affiche les jeux
 * concernes.
 */

import { esc, icon, openSheet, fmtNumber, plural } from './ui.js';
import {
  allGames, isComplete, tagList,
  CONDITIONS, CONDITION_LABELS, PARTS, SORTS,
} from './data.js';
import { plateforme, comparerPlateformes } from './platforms.js';
import { caseMarkup, shelfLength, condVar, handleBrokenImage } from './views.js';
import { actions } from './actions.js';

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
/** Pourcentage affiche : « < 1 » plutot qu'un zero trompeur. */
const pctLabel = (n, total) => (n > 0 && pct(n, total) === 0 ? '< 1' : String(pct(n, total)));
/** Largeur d'une jauge : un seul jeu reste visible. */
const gauge = (n, total) => (n > 0 ? Math.max((n / total) * 100, 1.5) : 0).toFixed(1);

function meterRow({ label, n, total, color = '', filter }) {
  return `<button type="button" class="meter-row" data-filter='${esc(JSON.stringify(filter))}'>
    <span>${esc(label)}</span>
    <span class="meter-track"><span style="width:${gauge(n, total)}%;${color}"></span></span>
    <em>${fmtNumber(n)}</em>
  </button>`;
}

export function openStats() {
  const games = allGames();
  const total = games.length;
  const mm = shelfLength(games);
  const copies = games.reduce((n, g) => n + (Number(g.quantity) || 1), 0);

  // Plateformes, dans l'ordre de l'etagere.
  const byPlatform = new Map();
  for (const g of games) byPlatform.set(g.platform, (byPlatform.get(g.platform) || 0) + 1);
  const platforms = [...byPlatform].sort((a, b) => comparerPlateformes(a[0], b[0]));

  const complete = games.filter(isComplete).length;
  const missingCounts = PARTS.map((part) => [part, games.filter((g) => !g[part.key]).length]);
  const withIso = games.filter((g) => g.has_iso).length;

  const byCondition = new Map();
  for (const g of games) byCondition.set(g.condition, (byCondition.get(g.condition) || 0) + 1);

  const byRegion = new Map();
  for (const g of games) if (g.region) byRegion.set(g.region, (byRegion.get(g.region) || 0) + 1);

  const tags = new Map();
  for (const g of games) for (const t of tagList(g)) tags.set(t, (tags.get(t) || 0) + 1);

  const recent = [...games].sort(SORTS.recent.compare).slice(0, 6);

  const metres = (mm / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const sheet = openSheet({
    className: 'sheet--stats',
    label: 'Bilan de la collection',
    content: `<div class="sheet-wrap">
      <div class="sheet-head">
        <h2 class="sheet-title">Bilan</h2>
        <button type="button" class="icon-btn" data-close aria-label="Fermer">${icon('close')}</button>
      </div>
      <div class="sheet-body">
        <div class="stats-hero">
          <p class="stats-big">${metres}<small>m</small></p>
          <p class="stats-lede">d’étagère pour <strong>${plural(total, 'jeu', 'jeux')}</strong>${copies !== total ? ` et ${plural(copies, 'exemplaire')}` : ''}, à l’épaisseur réelle de chaque boîtier.</p>
        </div>

        <section class="block" style="margin-top:28px">
          <h3 class="section-label">Plateformes</h3>
          <div class="bar" aria-hidden="true">${platforms.map(([name, n]) =>
            `<span style="--n:${n};--c:${plateforme(name).trait}" title="${esc(name || 'Sans plateforme')} : ${n}"></span>`).join('')}</div>
          <div class="legend">${platforms.map(([name, n]) => `
            <button type="button" data-filter='${esc(JSON.stringify({ platform: name }))}'>
              <span class="swatch" style="--c:${plateforme(name).trait}"></span>
              <b>${esc(name || 'Sans plateforme')}</b><em>${fmtNumber(n)} · ${pctLabel(n, total)} %</em>
            </button>`).join('')}</div>
        </section>

        <div class="stats-cols block" style="margin-top:28px">
          <section>
            <h3 class="section-label">Boîtes complètes</h3>
            <p class="stat-figure">${pct(complete, total)} % <small>${fmtNumber(complete)} sur ${fmtNumber(total)}</small></p>
            <div class="meter" style="margin-top:14px">
              ${missingCounts.map(([part, n]) => meterRow({
                label: `Sans ${part.missing}`, n, total, color: 'background:var(--warn)', filter: { q: `sans ${part.missing}` },
              })).join('')}
            </div>
          </section>
          <section>
            <h3 class="section-label">État</h3>
            <div class="bar" aria-hidden="true" style="margin-bottom:12px">${[...CONDITIONS, ''].filter((c) => byCondition.get(c)).map((c) =>
              `<span style="--n:${byCondition.get(c)};--c:var(--c-${c || 'none'})"></span>`).join('')}</div>
            <div class="meter">
              ${[...CONDITIONS, ''].filter((c) => byCondition.get(c)).map((c) => meterRow({
                label: CONDITION_LABELS[c], n: byCondition.get(c), total, color: `background:var(--cc);${condVar(c)}`,
                filter: { condition: c || '-' },
              })).join('')}
            </div>
          </section>
        </div>

        <div class="stats-cols block" style="margin-top:28px">
          <section>
            <h3 class="section-label">Sauvegardes ISO</h3>
            <p class="stat-figure">${pct(withIso, total)} % <small>${fmtNumber(withIso)} sur ${fmtNumber(total)}</small></p>
            <div class="meter" style="margin-top:14px">
              ${meterRow({ label: 'Avec ISO', n: withIso, total, color: 'background:var(--ok)', filter: { iso: '1' } })}
              ${meterRow({ label: 'Sans ISO', n: total - withIso, total, filter: { iso: '0' } })}
            </div>
          </section>
          <section>
            <h3 class="section-label">Régions</h3>
            <div class="meter">
              ${[...byRegion].sort((a, b) => b[1] - a[1]).map(([r, n]) => meterRow({ label: r, n, total, filter: { region: r } })).join('')}
            </div>
            ${tags.size ? `<h3 class="section-label" style="margin-top:20px">Tags</h3>
              <div class="taglist">${[...tags].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) =>
                `<button type="button" class="tag" data-filter='${esc(JSON.stringify({ tag: t }))}'>${esc(t)} · ${n}</button>`).join('')}</div>` : ''}
          </section>
        </div>

        ${recent.length ? `<section class="block" style="margin-top:28px">
          <h3 class="section-label">Derniers ajouts</h3>
          <div class="recent-covers">${recent.map((g) => `
            <button type="button" data-open="${g.id}" data-id="${g.id}" aria-label="${esc(g.title)}">
              <span class="card-stage">${caseMarkup(g)}</span>
            </button>`).join('')}</div>
        </section>` : ''}
      </div></div>`,
  });

  sheet.el.addEventListener('error', handleBrokenImage, true);
  sheet.el.addEventListener('click', (event) => {
    const filter = event.target.closest('[data-filter]');
    if (filter) {
      sheet.close();
      actions.showOnly(JSON.parse(filter.dataset.filter));
      return;
    }
    const open = event.target.closest('[data-open]');
    if (open) actions.openDetail(Number(open.dataset.open));
  });
  return sheet;
}
