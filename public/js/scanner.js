/*
 * « Est-ce que je l'ai ? » — la question qu'on se pose devant un rayon.
 *
 * On photographie le code-barres au dos du boitier, et la reponse vient de
 * la collection gardee sur l'appareil : elle tombe instantanement, et elle
 * tombe aussi en magasin, loin du Wi-Fi de la maison.
 *
 * La prise de vue est confiee a l'appareil photo du systeme : mise au point
 * macro, stabilisation, pleine definition. Techniquement ce n'est qu'un
 * champ de fichier : aucune permission a accorder, et cela fonctionne meme
 * en HTTP simple, la ou la camera en direct est refusee.
 */

import { api } from './api.js';
import { esc, icon, openSheet, toast } from './ui.js';
import { collection, findByEan, onChange, CONDITION_SHORT } from './data.js';
import { plateforme } from './platforms.js';
import { spineVars, partsSummary } from './views.js';
import { createBarcodeDetector } from './barcode.js';
import { actions } from './actions.js';

/*
 * Cadrages essayes sur une photo, dans l'ordre : `part` est la fraction
 * gardee autour du centre, `largeur` la definition d'analyse. En dessous de
 * 2200 pixels, des essais ont produit un code faux dont la clef de controle
 * tombait juste — de quoi repartir avec un jeu que l'on possede deja.
 */
const CADRAGES = [
  { part: 1, largeur: 2200 },
  { part: 1, largeur: 4032 },
  { part: 0.6, largeur: 2400 },
];

async function readPhoto(file, reader) {
  let source;
  try {
    // Sans cette option, une photo prise en portrait arrive parfois couchee.
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await createImageBitmap(file);
  }
  try {
    for (const { part, largeur } of CADRAGES) {
      const sw = source.width * part;
      const sh = source.height * part;
      const scale = Math.min(1, largeur / sw);
      const crop = await createImageBitmap(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh);
      const codes = await reader.detect(crop, Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
      if (codes[0]?.rawValue) return codes[0].rawValue;
    }
    return null;
  } finally {
    source.close?.();
  }
}

/** Codes lus pendant la session : en rayon, on en enchaine plusieurs. */
const history = [];

function hitMarkup(game) {
  const p = plateforme(game.platform);
  const thumb = game.cover_url ? `<img src="${esc(game.cover_url)}" alt="" referrerpolicy="no-referrer">` : '';
  const meta = [
    [game.platform, game.region].filter(Boolean).join(' · '),
    game.condition ? CONDITION_SHORT[game.condition] : '',
    game.quantity > 1 ? `${game.quantity} exemplaires` : '',
    partsSummary(game),
  ].filter(Boolean).join(' · ');
  return `<button type="button" class="hit" data-open="${game.id}">
    <span class="row-thumb" style="${spineVars(p)}">${thumb}</span>
    <span><strong>${esc(game.title)}</strong><span>${esc(meta)}</span></span>
    ${icon('chevron', { size: 18 })}
  </button>`;
}

function verdictMarkup(code, games) {
  if (games.length) {
    return `<div class="verdict verdict--owned">
      <div class="verdict-head">
        <span class="verdict-mark">${icon('check', { size: 24, stroke: 2.6 })}</span>
        <div><p class="verdict-title">Déjà dans votre collection</p><p class="verdict-code">${esc(code)}</p></div>
      </div>
      <div class="verdict-body">${games.map(hitMarkup).join('')}</div>
    </div>`;
  }
  return `<div class="verdict verdict--new">
    <div class="verdict-head">
      <span class="verdict-mark">${icon('plus', { size: 24, stroke: 2.6 })}</span>
      <div><p class="verdict-title">Pas dans votre collection</p><p class="verdict-code">${esc(code)}</p></div>
    </div>
    <div class="verdict-body">
      <button type="button" class="btn btn--primary btn--block" data-add="${esc(code)}">${icon('plus')}Ajouter ce jeu</button>
    </div>
  </div>`;
}

function historyMarkup() {
  if (history.length < 2) return '';
  return `<h3 class="section-label">Codes lus</h3><ul>${history.slice(0, 6).map((h) => `
    <li><span class="mono">${esc(h.code)}</span>${h.title
      ? `<span class="yes">${esc(h.title)}</span>`
      : '<span class="no">absent</span>'}</li>`).join('')}</ul>`;
}

/**
 * Ouvre le scanner. Avec `onCode`, il sert seulement a lire un code pour un
 * formulaire : le code est rendu et la fenetre se ferme.
 */
export function openScanner({ onCode = null } = {}) {
  let closed = false;
  let reader = null;
  let readerPromise = null;

  const sheet = openSheet({
    className: 'sheet--scan',
    label: onCode ? 'Lire un code-barres' : 'Est-ce que je l’ai ?',
    content: `<div class="sheet-wrap">
      <div class="sheet-head">
        <h2 class="sheet-title">${onCode ? 'Lire un code-barres' : 'Est-ce que je l’ai ?'}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Fermer">${icon('close')}</button>
      </div>
      <div class="sheet-body">
        <p class="scan-intro">${onCode
          ? 'Photographiez le code-barres : il sera reporté dans la fiche.'
          : 'Photographiez le code-barres au dos du boîtier. La réponse vient de la collection enregistrée sur cet appareil, même sans réseau.'}</p>
        <button type="button" class="btn btn--primary btn--lg btn--block scan-photo" data-photo>${icon('camera', { size: 20 })}Photographier le code-barres</button>
        <input type="file" accept="image/*" capture="environment" data-file hidden>
        <p class="scan-status" role="status" data-status></p>
        <p class="scan-or">ou</p>
        <form class="scan-manual" data-manual novalidate>
          <input class="input" name="code" inputmode="numeric" autocomplete="off" maxlength="18"
            placeholder="Saisir les chiffres" aria-label="Code-barres">
          <button type="submit" class="btn">Vérifier</button>
        </form>
        <div data-verdict aria-live="polite"></div>
        <div class="recent-scans" data-history></div>
      </div></div>`,
    onClose: () => {
      closed = true;
      reader?.close();
      reader = null;
      unsubscribe();
    },
  });

  // Le jeu vient d'etre ajoute (ou supprime) depuis le verdict : la reponse
  // affichee pour le dernier code est remise a jour.
  let lastCode = null;
  const unsubscribe = onChange(() => {
    if (!lastCode || !collection.ready) return;
    verdictBox.innerHTML = verdictMarkup(lastCode, findByEan(lastCode));
  });

  const status = sheet.$('[data-status]');
  const verdictBox = sheet.$('[data-verdict]');
  const fileInput = sheet.$('[data-file]');

  // Le decodeur pese 350 Ko et occupe un worker : il ne demarre qu'a la
  // premiere photo, et il est rendu a la fermeture.
  const getReader = () => {
    readerPromise ??= createBarcodeDetector().then((r) => {
      if (closed) {
        r.close();
        return null;
      }
      reader = r;
      return r;
    });
    return readerPromise;
  };

  async function answer(raw) {
    const code = String(raw).replace(/[\s-]/g, '');
    if (!/^\d{8,14}$/.test(code)) {
      status.textContent = 'Un code-barres compte de 8 à 14 chiffres.';
      return;
    }
    if (onCode) {
      onCode(code);
      toast(`Code-barres ${code} reporté`);
      sheet.close();
      return;
    }

    let games;
    if (collection.ready) {
      games = findByEan(code);
    } else {
      try {
        games = (await api.lookup(code)).games;
      } catch (err) {
        status.textContent = `Recherche impossible : ${err.message}`;
        return;
      }
    }
    navigator.vibrate?.(games.length ? [40, 60, 40] : 60);
    status.textContent = '';
    lastCode = code;
    verdictBox.innerHTML = verdictMarkup(code, games);
    history.unshift({ code, title: games[0]?.title || '' });
    sheet.$('[data-history]').innerHTML = historyMarkup();
  }

  sheet.$('[data-manual]').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = event.target.elements.code;
    input.blur();
    answer(input.value);
  });

  sheet.$('[data-photo]').addEventListener('click', () => {
    if (typeof createImageBitmap !== 'function') {
      status.textContent = 'Ce navigateur ne sait pas lire une photo : saisissez les chiffres.';
      return;
    }
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    // Vider tout de suite : reprendre la meme boite doit relancer la lecture.
    fileInput.value = '';
    if (!file) return;
    status.textContent = 'Lecture de la photo…';
    verdictBox.innerHTML = '';
    try {
      const r = await getReader();
      if (!r) return;
      const code = await readPhoto(file, r);
      if (!code) {
        status.textContent = 'Aucun code-barres lisible. Reprenez la photo de plus près, le code bien à plat et entier dans l’image.';
        return;
      }
      sheet.$('[data-manual]').elements.code.value = code;
      await answer(code);
    } catch (err) {
      status.textContent = `Photo illisible : ${err.message}`;
    }
  });

  verdictBox.addEventListener('click', (event) => {
    const open = event.target.closest('[data-open]');
    if (open) {
      // Par-dessus le scanner : le retour y ramene, pour le jeu suivant.
      actions.openDetail(Number(open.dataset.open));
      return;
    }
    const add = event.target.closest('[data-add]');
    if (add) actions.openEditor(null, { ean: add.dataset.add });
  });

  return sheet;
}
