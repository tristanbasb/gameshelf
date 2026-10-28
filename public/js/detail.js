/*
 * Fiche d'un jeu.
 *
 * Elle se lit comme un boitier que l'on a en main : la jaquette d'un cote,
 * de l'autre ce que l'on possede — l'etat, ce que contient la boite, l'ISO,
 * le nombre d'exemplaires, puis l'etiquette du dos avec le code-barres.
 *
 * Tout ce qui se corrige souvent se corrige ici, d'un geste, sans ouvrir le
 * formulaire : retrouver une notice au fond d'un carton, c'est un toucher.
 */

import {
  esc, icon, openSheet, toast, copyText, confirmSheet, fmtDate,
} from './ui.js';
import {
  getGame, patchGame, deleteGame, createGame, onChange, tagList,
  CONDITIONS, CONDITION_SHORT, CONDITION_LABELS, PARTS, missingParts,
} from './data.js';
import { plateforme } from './platforms.js';
import { caseMarkup, coverAttrs, condVar, spineVars, handleBrokenImage } from './views.js';
import { barcodeSvg } from './ean.js';
import { actions } from './actions.js';

const PART_ICONS = { has_box: 'box', has_cover_art: 'cover', has_manual: 'manual', has_disc: 'disc' };

function stageMarkup(game) {
  const p = plateforme(game.platform);
  // Le halo est flou : la miniature, deja chargee par la grille, lui suffit.
  // Le boitier, lui, montre l'image d'origine.
  const glow = game.cover_url
    ? `<img class="detail-glow" ${coverAttrs(game.cover_url)} alt="" aria-hidden="true">`
    : '';
  return `<div class="detail-stage" data-id="${game.id}" style="${spineVars(p)}">${glow}${caseMarkup(game, { sized: false, eager: true, original: true })}</div>`;
}

const scaleMarkup = (game) => CONDITIONS.map((c) => `
  <button type="button" class="scale-step" role="radio" data-cond="${c}" data-k="cond-${c}" style="${condVar(c)}"
    aria-checked="${game.condition === c}" title="${esc(CONDITION_LABELS[c])}">${esc(CONDITION_SHORT[c])}</button>`).join('');

const partsMarkup = (game) => PARTS.map((part) => `
  <button type="button" class="toggle" data-part="${part.key}" data-k="part-${part.key}" aria-pressed="${Boolean(game[part.key])}">
    ${icon(PART_ICONS[part.key])}<span>${esc(part.label)}</span>
    <span class="toggle-state">${game[part.key] ? 'Présent' : 'Manque'}</span>
  </button>`).join('');

function partsCaption(game) {
  const missing = missingParts(game);
  return missing.length ? `${PARTS.length - missing.length} sur ${PARTS.length}` : 'Complet';
}

function labelMarkup(game) {
  if (!game.ean && !game.serial) return '';
  const bars = barcodeSvg(game.ean);
  return `<section class="block">
    <h3 class="section-label">Étiquette du dos</h3>
    <div class="label-card">
      ${bars || ''}
      <div class="label-lines">
        ${game.serial ? `<div class="label-line"><span>Serial</span><strong>${esc(game.serial)}</strong></div>` : ''}
        ${game.ean ? `<div class="label-line"><span>EAN</span><strong>${esc(game.ean)}</strong></div>` : ''}
      </div>
    </div>
  </section>`;
}

function datesLine(game) {
  const added = fmtDate(game.created_at);
  const updated = fmtDate(game.updated_at);
  return updated && updated !== added ? `Ajouté le ${added} · modifié le ${updated}` : `Ajouté le ${added}`;
}

function infoMarkup(game) {
  const p = plateforme(game.platform);
  const eyebrow = [game.platform, game.region].filter(Boolean);
  const tags = tagList(game);
  return `
    <div class="detail-top">
      <p class="detail-eyebrow">
        <span class="swatch" style="--c:${p.trait}"></span>
        <span>${esc(eyebrow.join(' · ') || 'Plateforme non renseignée')}</span>
      </p>
      <div class="detail-head-actions">
        <button type="button" class="icon-btn" data-fav data-k="fav" aria-pressed="${Boolean(game.favorite)}"
          aria-label="${game.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}"
          title="${game.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${icon('star', { fill: Boolean(game.favorite) })}</button>
        <button type="button" class="icon-btn" data-copy aria-label="Copier le titre" title="Copier le titre">${icon('copy')}</button>
        <button type="button" class="icon-btn" data-close aria-label="Fermer la fiche" title="Fermer">${icon('close')}</button>
      </div>
    </div>
    <h2 class="detail-title" id="detail-title">${esc(game.title)}</h2>

    <section class="block" style="margin-top:22px">
      <h3 class="section-label">État</h3>
      <div class="scale" role="radiogroup" aria-label="État de l'exemplaire">${scaleMarkup(game)}</div>
    </section>

    <section class="block">
      <h3 class="section-label">Contenu de la boîte · <span data-parts-caption>${partsCaption(game)}</span></h3>
      <div class="parts-grid" data-parts>${partsMarkup(game)}</div>
    </section>

    <section class="block">
      <div class="facts">
        <div>
          <h3 class="section-label">Sauvegarde</h3>
          <button type="button" class="toggle toggle--plain" data-iso data-k="iso" aria-pressed="${Boolean(game.has_iso)}" style="width:100%">
            ${icon('iso')}<span>ISO</span><span class="toggle-state">${game.has_iso ? 'Oui' : 'Non'}</span>
          </button>
        </div>
        <div>
          <h3 class="section-label">Exemplaires</h3>
          <div class="stepper">
            <button type="button" data-qty="-1" data-k="qty-" aria-label="Un exemplaire de moins">${icon('minus')}</button>
            <output data-qty-value aria-live="polite">${game.quantity}</output>
            <button type="button" data-qty="1" data-k="qty+" aria-label="Un exemplaire de plus">${icon('plus')}</button>
          </div>
        </div>
      </div>
    </section>

    ${labelMarkup(game)}

    ${tags.length ? `<section class="block">
      <h3 class="section-label">Tags</h3>
      <div class="taglist">${tags.map((t) => `<button type="button" class="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    </section>` : ''}

    ${game.notes ? `<section class="block">
      <h3 class="section-label">Notes</h3>
      <p class="notes">${esc(game.notes)}</p>
    </section>` : ''}

    <p class="block dates">${esc(datesLine(game))}</p>`;
}

/** Ouvre la fiche. `from` : fenetre a remplacer (scanner, bilan). */
export function openDetail(id, { from = null } = {}) {
  const game = getGame(id);
  if (!game) {
    toast('Ce jeu n’est plus dans la collection.', { tone: 'error' });
    return null;
  }

  const options = {
    className: 'sheet--detail',
    label: game.title,
    content: `<div class="sheet-wrap">
      <div class="detail">
        ${stageMarkup(game)}
        <div class="detail-info">
          <div class="detail-scroll" data-info>${infoMarkup(game)}</div>
          <div class="sheet-foot">
            <button type="button" class="btn btn--ghost btn--danger" data-delete>${icon('trash')}Supprimer</button>
            <span class="spacer"></span>
            <button type="button" class="btn btn--primary" data-edit>${icon('edit')}Modifier la fiche</button>
          </div>
        </div>
      </div></div>`,
    onClose: () => unsubscribe(),
  };
  const sheet = from ? from.swap(options) : openSheet(options);
  sheet.el.setAttribute('aria-labelledby', 'detail-title');
  sheet.el.addEventListener('error', handleBrokenImage, true);

  const current = () => getGame(id);

  // Une modification faite ailleurs (ou refusee par le serveur) repeint la
  // fiche ouverte. Le defilement de la colonne est conserve.
  const unsubscribe = onChange((reason) => {
    const fresh = current();
    if (!fresh) {
      if (reason === 'delete') sheet.close();
      return;
    }
    const info = sheet.$('[data-info]');
    const focusKey = document.activeElement?.closest('[data-k]')?.dataset.k;
    const scroll = info.scrollTop;
    info.innerHTML = infoMarkup(fresh);
    info.scrollTop = scroll;
    if (focusKey) info.querySelector(`[data-k="${focusKey}"]`)?.focus({ preventScroll: true });
  });

  const save = (changes) => patchGame(id, changes).catch((err) => {
    toast(`Modification refusée : ${err.message}`, { tone: 'error' });
  });

  sheet.el.addEventListener('click', async (event) => {
    const target = event.target;
    const game = current();
    if (!game) return;

    const cond = target.closest('[data-cond]');
    if (cond) {
      // Toucher l'etat deja choisi l'efface : « non renseigne ».
      save({ condition: game.condition === cond.dataset.cond ? '' : cond.dataset.cond });
      return;
    }
    const part = target.closest('[data-part]');
    if (part) {
      save({ [part.dataset.part]: game[part.dataset.part] ? 0 : 1 });
      return;
    }
    if (target.closest('[data-iso]')) {
      save({ has_iso: game.has_iso ? 0 : 1 });
      return;
    }
    const qty = target.closest('[data-qty]');
    if (qty) {
      const next = Math.max(1, Math.min(9999, Number(game.quantity) + Number(qty.dataset.qty)));
      if (next !== game.quantity) save({ quantity: next });
      return;
    }
    if (target.closest('[data-fav]')) {
      save({ favorite: game.favorite ? 0 : 1 });
      return;
    }
    const copy = target.closest('[data-copy]');
    if (copy) {
      if (await copyText(game.title)) {
        copy.classList.add('is-done');
        copy.innerHTML = icon('check');
        setTimeout(() => {
          copy.classList.remove('is-done');
          copy.innerHTML = icon('copy');
        }, 1400);
      } else {
        toast('Copie impossible sur ce navigateur.', { tone: 'error' });
      }
      return;
    }
    const tag = target.closest('[data-tag]');
    if (tag) {
      sheet.close();
      actions.showOnly({ tag: tag.dataset.tag });
      return;
    }
    if (target.closest('[data-edit]')) {
      actions.openEditor(game, {}, { from: sheet });
      return;
    }
    if (target.closest('[data-delete]')) {
      removeGame(game, sheet);
    }
  });

  return sheet;
}

/**
 * Suppression, apres confirmation, avec une fenetre de rattrapage : la fiche
 * se recree depuis la notification pendant neuf secondes.
 */
export async function removeGame(game, sheet) {
  const ok = await confirmSheet({
    title: 'Supprimer ce jeu ?',
    message: 'Il sera retiré de la collection. Vous pourrez annuler pendant quelques secondes.',
    confirmLabel: 'Supprimer',
    danger: true,
    subject: { name: game.title, ref: [game.platform, game.region, game.serial].filter(Boolean).join(' · ') },
  });
  if (!ok) return;
  try {
    await deleteGame(game.id);
    sheet?.close();
    toast(`« ${game.title} » supprimé`, {
      duration: 9000,
      action: {
        label: 'Annuler',
        onClick: async () => {
          try {
            await createGame(game);
            toast(`« ${game.title} » restauré`);
          } catch (err) {
            toast(`Restauration impossible : ${err.message}`, { tone: 'error' });
          }
        },
      },
    });
  } catch (err) {
    toast(`Suppression impossible : ${err.message}`, { tone: 'error' });
  }
}

