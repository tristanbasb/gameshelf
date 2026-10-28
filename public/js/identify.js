/*
 * Identifier un jeu avec Claude.
 *
 * Une photo du boitier, le code-barres et, s'il est connu, le serial : le
 * serveur les confie a Claude, qui lit la photo, cherche le code sur le web et
 * propose une fiche. Le serveur verifie ensuite ce qui peut l'etre (voir
 * src/identification.js) et rend un verdict.
 *
 * Cette fenetre est la validation : la fiche proposee, ce qui la confirme, ce
 * qui la contredit, les sources. Rien n'est rempli tant que l'on n'a pas
 * repondu « C'est bien ce jeu » — et le formulaire qui suit s'enregistre
 * encore a la main.
 */

import { api } from './api.js';
import { esc, icon, openSheet } from './ui.js';
import { findByEan, similarTitles } from './data.js';
import { createBarcodeDetector } from './barcode.js';
import { readPhoto } from './scanner.js';
import { actions } from './actions.js';

/** Au-dela, on cesse d'attendre : le serveur abandonne lui-meme avant. */
const DELAI_MS = 150000;

/*
 * Plus grand cote de la photo envoyee. Une photo de telephone pese plusieurs
 * mega-octets ; reduite, elle part en une seconde sur le Wi-Fi et reste assez
 * fine pour les petits caracteres du dos.
 */
const COTE_MAX = 2000;

const VERDICTS = {
  confirmed: { label: 'Jeu confirmé', mark: 'check' },
  likely: { label: 'Probablement ce jeu', mark: 'check' },
  uncertain: { label: 'Identification incertaine', mark: 'alert' },
  not_found: { label: 'Jeu non identifié', mark: 'search' },
};

const FIELDS = [
  ['title', 'Titre'],
  ['platform', 'Plateforme'],
  ['region', 'Région'],
  ['serial', 'Serial', 'mono'],
  ['ean', 'Code-barres', 'mono'],
];

/** Phrase de chaque verification renvoyee par le serveur. */
function checkText(c) {
  switch (c.key) {
    case 'no_ean':
      return 'Sans code-barres, l’édition exacte — région, réédition — reste à vérifier';
    case 'ean_key':
      return c.ok
        ? `Clé de contrôle du code-barres ${c.ean} juste`
        : `Clé de contrôle fausse : un chiffre de ${c.ean} est sans doute mal lu`;
    case 'photo_ean':
      return c.ok ? 'Les chiffres sous le code-barres de la photo concordent' : `La photo montre ${c.photo}, pas ${c.given}`;
    case 'proposed_ean':
      return c.ok ? 'La fiche trouvée porte ce code-barres' : `La fiche trouvée porte un autre code-barres (${c.proposed})`;
    case 'serial':
      return c.ok ? `Le serial ${c.given} correspond à cette édition` : `Serial fourni : ${c.given}, mais cette édition porte ${c.proposed}`;
    case 'photo_serial':
      return c.ok ? 'Le serial lu sur la photo concorde' : `Serial lu sur la photo : ${c.photo}, fiche : ${c.proposed}`;
    case 'region':
      return c.ok ? `La région de la boîte (${c.photo}) concorde` : `La boîte indique ${c.photo}, la fiche ${c.proposed}`;
    case 'title_on_photo':
      return c.ok ? `Titre lu sur la photo : « ${c.title} »` : 'Titre non lisible sur la photo';
    case 'sources':
      if (!c.withEan) {
        return c.count
          ? `${c.count} source${c.count > 1 ? 's' : ''} en ligne confirme${c.count > 1 ? 'nt' : ''} ce titre`
          : 'Aucune source en ligne ne confirme ce titre';
      }
      return c.count
        ? `${c.count} source${c.count > 1 ? 's' : ''} en ligne relie${c.count > 1 ? 'nt' : ''} ce code-barres à ce titre`
        : 'Aucune source en ligne ne relie ce code-barres à ce titre';
    default:
      return '';
  }
}

function checksMarkup(checks) {
  const items = checks.map((c) => {
    const tone = c.ok === true ? 'is-ok' : c.ok === false ? 'is-ko' : 'is-na';
    const mark = c.ok === true ? 'check' : c.ok === false ? 'alert' : 'minus';
    return `<li class="${tone}">${icon(mark, { size: 16, stroke: 2.4 })}<span>${esc(checkText(c))}</span></li>`;
  });
  const sources = checks.find((c) => c.key === 'sources');
  if (sources?.discarded) {
    items.push(`<li class="is-na">${icon('minus', { size: 16, stroke: 2.4 })}<span>${sources.discarded} source${sources.discarded > 1 ? 's citées' : ' citée'} hors des résultats de recherche, écartée${sources.discarded > 1 ? 's' : ''}</span></li>`);
  }
  return `<ul class="id-checks">${items.join('')}</ul>`;
}

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function resultMarkup(result) {
  const v = VERDICTS[result.verdict] || VERDICTS.uncertain;
  const game = result.game || {};
  const identified = result.verdict !== 'not_found';

  // Le jeu est peut-etre deja la : meme code-barres, ou titre tres proche.
  const owned = identified
    ? [...new Map([
      ...(game.ean ? findByEan(game.ean) : []),
      ...(game.title ? similarTitles(game.title, { threshold: 0.85, limit: 2 }) : []),
    ].map((g) => [g.id, g])).values()]
    : [];

  return `
    <div class="verdict verdict--${esc(result.verdict)}">
      <div class="verdict-head">
        <span class="verdict-mark">${icon(v.mark, { size: 24, stroke: 2.6 })}</span>
        <div><p class="verdict-title">${esc(v.label)}</p>
          ${result.summary ? `<p class="id-summary">${esc(result.summary)}</p>` : ''}</div>
      </div>
      ${identified ? `<div class="verdict-body"><dl class="id-fields">${FIELDS.map(([key, label, cls]) => `
        <div><dt>${label}</dt><dd class="${cls || ''}">${game[key] ? esc(game[key]) : '<span class="hint">—</span>'}</dd></div>`).join('')}
      </dl></div>` : ''}
    </div>
    ${owned.map((g) => `
      <div class="dupe id-block">${icon('box', { size: 16 })}
        <span>Déjà dans la collection : <strong>${esc(g.title)}</strong>${g.platform ? ` · ${esc(g.platform)}` : ''}</span>
        <button type="button" data-see="${g.id}">Voir</button></div>`).join('')}
    <section class="id-block">
      <h3 class="section-label">Vérifications</h3>
      ${checksMarkup(result.checks || [])}
    </section>
    ${result.doubts?.length ? `<section class="id-block">
      <h3 class="section-label">Points d’attention</h3>
      <ul class="id-doubts">${result.doubts.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
    </section>` : ''}
    ${result.sources?.length ? `<section class="id-block">
      <h3 class="section-label">Sources</h3>
      <div class="id-sources">${result.sources.map((s) => `
        <a class="id-source" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">
          <strong>${esc(s.title || host(s.url))}</strong><span>${esc(host(s.url))}</span></a>`).join('')}</div>
    </section>` : ''}`;
}

/** Photo reduite en JPEG, ou telle quelle si le navigateur ne sait pas la redessiner. */
async function shrink(file) {
  if (typeof createImageBitmap !== 'function') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return file;
    }
  }
  const scale = Math.min(1, COTE_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return blob || file;
}

/**
 * Ouvre l'identification. `photo`, `ean` et `serial` pre-remplissent ce que
 * l'on sait deja ; `onConfirm(game, sheet)` recoit la fiche validee.
 * `capture` ouvre l'appareil photo d'emblee ; `run` lance l'identification
 * sans attendre, avec ce qui a ete fourni. Une photo prise dans la fenetre
 * la lance aussi : photographier le jeu suffit.
 */
export function openIdentify({
  photo = null, ean = '', eanSource = 'saisie', serial = '', capture = false, run: runNow = false, onConfirm,
}) {
  let file = photo;
  let source = ean ? eanSource : 'saisie';
  let previewUrl = '';
  let pending = null;
  let result = null;

  const sheet = openSheet({
    className: 'sheet--identify',
    label: 'Identifier avec Claude',
    content: `<div class="sheet-wrap">
      <div class="sheet-head">
        <h2 class="sheet-title">Identifier avec Claude</h2>
        <button type="button" class="icon-btn" data-close aria-label="Fermer">${icon('close')}</button>
      </div>
      <div class="sheet-body" data-body></div>
      <div class="sheet-foot" data-foot></div>
    </div>`,
    onClose: () => {
      pending?.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
  });
  const body = sheet.$('[data-body]');
  const foot = sheet.$('[data-foot]');
  const values = { ean, serial };

  const photoMarkup = () => (file
    ? `<img src="${previewUrl}" alt="Photo du boîtier">`
    : `${icon('camera', { size: 22 })}<span>Aucune photo</span>`);

  /* --- 1. Ce que l'on sait --------------------------------------------- */

  function showForm(message = '') {
    result = null;
    body.innerHTML = `
      <p class="scan-intro">Photographiez le jeu : face avant, dos ou disque. Claude lit la photo, cherche en ligne et vous propose la fiche, que vous validez avant tout enregistrement. Avec le code-barres au dos, l’édition exacte peut être confirmée.</p>
      <div class="id-photo" data-photo-box>${photoMarkup()}</div>
      <button type="button" class="btn btn--block id-take" data-take>${icon('camera', { size: 18 })}${file ? 'Changer de photo' : 'Photographier le jeu'}</button>
      <input type="file" accept="image/*" capture="environment" data-file hidden>
      <div class="form-grid id-block">
        <div class="field">
          <label for="id-ean">Code-barres</label>
          <input class="input mono" id="id-ean" name="ean" inputmode="numeric" maxlength="14" autocomplete="off"
            placeholder="Lu sur la photo, ou à taper" value="${esc(values.ean)}">
        </div>
        <div class="field">
          <label for="id-serial">Serial <span class="hint">facultatif</span></label>
          <input class="input mono" id="id-serial" name="serial" autocomplete="off" autocapitalize="characters"
            placeholder="SLES-52237" value="${esc(values.serial)}">
        </div>
      </div>
      <p class="scan-status" role="status" data-status>${esc(message)}</p>`;
    foot.innerHTML = `<span class="spacer"></span>
      <button type="button" class="btn btn--primary" data-go>${icon('spark')}Identifier</button>`;
  }

  const status = (text) => {
    const el = body.querySelector('[data-status]');
    if (el) el.textContent = text;
  };

  async function takePhoto(picked) {
    file = picked;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    body.querySelector('[data-photo-box]').innerHTML = photoMarkup();
    body.querySelector('[data-take]').innerHTML = `${icon('camera', { size: 18 })}Changer de photo`;

    // Si la photo montre le dos, le code-barres se lit ici, sans reseau :
    // c'est lui qui permettra de confirmer l'edition. Une face avant n'en a
    // pas, et ce n'est pas un echec — Claude lira le titre.
    const eanInput = body.querySelector('[name="ean"]');
    if (!eanInput.value.trim() && typeof createImageBitmap === 'function') {
      status('Lecture de la photo…');
      let reader = null;
      try {
        reader = await createBarcodeDetector();
        const code = await readPhoto(file, reader);
        if (code && /^\d{8,14}$/.test(code) && !eanInput.value.trim()) {
          eanInput.value = code;
          values.ean = code;
          source = 'photo';
        }
      } catch {
        /* pas de code lisible : Claude fera avec la photo */
      } finally {
        reader?.close();
      }
    }
    // La photo prise, on n'attend pas un second geste.
    if (sheet.el.isConnected && body.querySelector('[data-file]')) run();
  }

  /* --- 2. Claude cherche ----------------------------------------------- */

  async function run() {
    const code = values.ean.replace(/[\s-]/g, '');
    if (code && !/^\d{8,14}$/.test(code)) {
      status('Un code-barres compte de 8 à 14 chiffres.');
      return;
    }
    if (!file && !code) {
      status('Il faut au moins une photo ou le code-barres.');
      return;
    }

    body.innerHTML = `<div class="id-wait">
        ${file ? `<img src="${previewUrl}" alt="">` : ''}
        <span class="id-bar" aria-hidden="true"></span>
        <p><strong>Claude examine ${file ? 'la photo' : 'le code-barres'}</strong></p>
        <p class="hint" data-elapsed>Lecture, recherche en ligne, recoupements… jusqu’à une minute.</p>
      </div>`;
    foot.innerHTML = '<span class="spacer"></span><button type="button" class="btn" data-cancel>Annuler</button>';

    const controller = new AbortController();
    pending = controller;
    const timer = setTimeout(() => controller.abort(), DELAI_MS);
    const started = Date.now();
    const ticker = setInterval(() => {
      const el = body.querySelector('[data-elapsed]');
      if (el) el.textContent = `Lecture, recherche en ligne, recoupements… ${Math.round((Date.now() - started) / 1000)} s`;
    }, 1000);

    try {
      const form = new FormData();
      if (file) form.append('photo', await shrink(file), 'boitier.jpg');
      form.append('ean', code);
      form.append('ean_source', source);
      form.append('serial', values.serial.trim());
      result = await api.identify(form, controller.signal);
      showResult();
    } catch (err) {
      // Annulee a la main, ou fenetre fermee : rien a annoncer.
      if (controller.signal.aborted && Date.now() - started < DELAI_MS) {
        if (sheet.el.isConnected) showForm();
        return;
      }
      showForm(`Identification impossible : ${err.message}`);
    } finally {
      clearTimeout(timer);
      clearInterval(ticker);
      if (pending === controller) pending = null;
    }
  }

  /* --- 3. Validation --------------------------------------------------- */

  function showResult() {
    body.innerHTML = resultMarkup(result);
    body.scrollTop = 0;
    const found = result.verdict !== 'not_found';
    const sure = result.verdict === 'confirmed' || result.verdict === 'likely';
    foot.innerHTML = found
      ? `<button type="button" class="btn btn--ghost" data-retry>Ce n’est pas ce jeu</button>
         <span class="spacer"></span>
         <button type="button" class="btn ${sure ? 'btn--primary' : ''}" data-confirm>${sure ? 'C’est bien ce jeu' : 'Remplir quand même'}</button>`
      : `<button type="button" class="btn btn--ghost" data-retry>Réessayer</button>
         <span class="spacer"></span>
         <button type="button" class="btn" data-manual>Saisir à la main</button>`;
  }

  /** Les champs proposes, sans ceux restes vides. */
  const proposed = () => Object.fromEntries(
    Object.entries(result?.game || {}).filter(([, value]) => value),
  );

  /* --- Evenements ------------------------------------------------------ */

  sheet.el.addEventListener('input', (event) => {
    const { name, value } = event.target;
    if (name === 'ean') {
      values.ean = value;
      source = 'saisie';
    } else if (name === 'serial') {
      values.serial = value;
    }
  });

  sheet.el.addEventListener('change', (event) => {
    if (!event.target.matches('[data-file]')) return;
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (picked) takePhoto(picked);
  });

  sheet.el.addEventListener('click', (event) => {
    const t = event.target;
    if (t.closest('[data-take]')) body.querySelector('[data-file]').click();
    else if (t.closest('[data-go]')) run();
    else if (t.closest('[data-cancel]')) pending?.abort();
    else if (t.closest('[data-retry]')) {
      showForm(result?.verdict === 'not_found'
        ? 'Rapprochez-vous du dos du boîtier, ou ajoutez le serial.'
        : 'Reprenez la photo de plus près, ou ajoutez le serial pour départager.');
    } else if (t.closest('[data-confirm]')) onConfirm?.(proposed(), sheet);
    else if (t.closest('[data-manual]')) onConfirm?.(values.ean ? { ean: values.ean.replace(/[\s-]/g, '') } : {}, sheet);
    else {
      const see = t.closest('[data-see]');
      if (see) actions.openDetail(Number(see.dataset.see));
    }
  });

  if (file) previewUrl = URL.createObjectURL(file);
  showForm();
  if (runNow && (file || ean)) run();
  // Dans le meme geste que le toucher qui a ouvert la fenetre : le
  // navigateur n'ouvre l'appareil photo qu'a cette condition.
  else if (capture) body.querySelector('[data-file]').click();
  return sheet;
}
