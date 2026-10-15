/** Outils d'interface : selection, echappement, icones, fenetres, notifications. */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Acces protege au stockage local : navigation privee, cookies bloques ou
 * contexte restreint peuvent le rendre indisponible. Une preference perdue
 * ne doit jamais empecher l'application de demarrer.
 */
export const store = {
  get(key, fallback = null) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* stockage indisponible ou plein : la valeur ne sera pas retenue */
    }
  },
};

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Echappe une valeur avant insertion dans du HTML genere. */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Fabrique un element a partir d'un fragment HTML. */
export function h(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

/** Texte avec des passages surlignes : `ranges` = [[debut, fin], ...]. */
export function marked(text, ranges) {
  if (!ranges?.length) return esc(text);
  let out = '';
  let at = 0;
  for (const [start, end] of ranges) {
    out += `${esc(text.slice(at, start))}<mark>${esc(text.slice(start, end))}</mark>`;
    at = end;
  }
  return out + esc(text.slice(at));
}

const nf = new Intl.NumberFormat('fr-FR');
export const fmtNumber = (n) => nf.format(Number(n) || 0);
export const plural = (n, one, many = `${one}s`) => `${fmtNumber(n)} ${n > 1 ? many : one}`;

export function fmtDate(value) {
  if (!value) return '';
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Copie dans le presse-papiers. L'API moderne exige une connexion securisee :
 * servie en HTTP simple sur le reseau local, on retombe sur l'ancienne
 * methode.
 */
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* refus : on tente le repli */
    }
  }
  try {
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Icones                                                                     */
/* -------------------------------------------------------------------------- */

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10.5 8v8M14 8v8M17 8v8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 17.3-6.2 3.6 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7z"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  covers: '<rect x="3" y="3" width="7.5" height="10" rx="1.2"/><rect x="13.5" y="3" width="7.5" height="10" rx="1.2"/><path d="M3 17h7.5M13.5 17h7.5M3 21h7.5M13.5 21h7.5"/>',
  shelf: '<path d="M2 21h20"/><rect x="4" y="4" width="3.2" height="17" rx=".6"/><rect x="8.6" y="7" width="3.2" height="14" rx=".6"/><rect x="13.2" y="3" width="3.2" height="18" rx=".6"/><path d="m18 8.5 2.6-.7 3 12.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  transfer: '<path d="M7 4v13M3 13l4 4 4-4"/><path d="M17 20V7M13 11l4-4 4 4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15v2M11 10v7M15 6v11M19 12v5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  camera: '<path d="M3 7h3l2-3h8l2 3h3v13H3z"/><circle cx="12" cy="13" r="4"/>',
  box: '<rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M8 2.5v19"/>',
  cover: '<rect x="4" y="2.5" width="16" height="19" rx="1"/><path d="M8 7h8M8 11h5"/>',
  manual: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5V4.5"/><path d="M9 7h7"/>',
  disc: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="2.6"/>',
  iso: '<path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/><circle cx="12" cy="9" r="6"/><circle cx="12" cy="9" r="1.4"/>',
  filter: '<path d="M3 5h18M6 12h12M10 19h4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  offline: '<path d="M2 8.8a15 15 0 0 1 4.2-2.6M8.5 5.1A15 15 0 0 1 22 8.8M5 12.6a10 10 0 0 1 5-2.5M14.8 10.4A10 10 0 0 1 19 12.6M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
  minus: '<path d="M5 12h14"/>',
  home: '<path d="M3 21h18"/><rect x="4" y="5" width="3.5" height="16" rx=".6"/><rect x="9.2" y="8" width="3.5" height="13" rx=".6"/><rect x="14.4" y="4" width="3.5" height="17" rx=".6"/>',
};

/** Icone SVG en ligne. `fill` remplit la forme (etoile de favori). */
export function icon(name, { size = 18, fill = false, stroke = 2 } = {}) {
  return `<svg class="i i-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"
    fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${stroke}"
    stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

let toastBox = null;

function toastContainer() {
  if (toastBox) return toastBox;
  toastBox = document.createElement('div');
  toastBox.className = 'toasts';
  toastBox.setAttribute('aria-live', 'polite');
  // En popover, la pile passe au-dessus des fenetres ouvertes : sans cela,
  // la confirmation d'un enregistrement resterait cachee derriere la fiche.
  if ('popover' in HTMLElement.prototype) toastBox.popover = 'manual';
  document.body.appendChild(toastBox);
  return toastBox;
}

function raiseToasts() {
  const box = toastContainer();
  if (!box.popover) return;
  try {
    if (box.matches(':popover-open')) box.hidePopover();
    if (box.childElementCount) box.showPopover();
  } catch {
    /* popover indisponible : la pile reste dans le flux normal */
  }
}

/**
 * Notification passagere. `action` ajoute un bouton — « Annuler » juste
 * apres une suppression, au moment ou l'on s'apercoit de l'erreur.
 */
export function toast(message, { tone = 'info', duration = 3800, action } = {}) {
  const box = toastContainer();
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);

  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => {
      el.remove();
      raiseToasts();
    }, 160);
  };

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      dismiss();
      action.onClick();
    });
    el.appendChild(button);
  }

  box.appendChild(el);
  raiseToasts();
  // Declare apres `dismiss`, qui s'y refere : la notification ne peut etre
  // renvoyee qu'une fois affichee.
  const timer = setTimeout(dismiss, duration);
}

/* -------------------------------------------------------------------------- */
/* Fenetres                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * Chaque fenetre ouverte ajoute une entree a l'historique du navigateur : le
 * bouton retour du telephone la ferme, au lieu de quitter l'application. On
 * garde la pile des fenetres pour savoir laquelle fermer.
 */
const stack = [];
let counter = 0;

function finalize(entry) {
  const at = stack.indexOf(entry);
  if (at === -1) return;
  stack.splice(at, 1);
  entry.dialog.close();
  entry.dialog.remove();
  entry.onClose?.();
  if (entry.returnFocus instanceof HTMLElement && document.contains(entry.returnFocus)) {
    entry.returnFocus.focus({ preventScroll: true });
  }
}

window.addEventListener('popstate', () => {
  // Ferme, du haut de la pile, tout ce qui est au-dessus de l'entree
  // d'historique ou l'on revient.
  const keep = stack.findIndex((entry) => entry.key === history.state?.gvSheet);
  for (let i = stack.length - 1; i > keep; i -= 1) finalize(stack[i]);
});

/**
 * Ouvre une fenetre. `content` est un element ou du HTML. Renvoie
 * `{ el, close, swap }` : `swap(options)` remplace cette fenetre par une
 * autre sans repasser par l'historique (de la fiche au formulaire, par
 * exemple).
 */
export function openSheet({ content, className = '', label = '', onClose, focus = null, replacing = null }) {
  const dialog = document.createElement('dialog');
  dialog.className = `sheet ${className}`.trim();
  if (label) dialog.setAttribute('aria-label', label);
  const body = typeof content === 'string' ? h(content) : content;
  if (!body.hasAttribute('tabindex')) body.tabIndex = -1;
  dialog.appendChild(body);
  document.body.appendChild(dialog);

  counter += 1;
  const entry = {
    key: `s${counter}-${Date.now()}`,
    dialog,
    onClose,
    returnFocus: replacing ? replacing.returnFocus : document.activeElement,
  };

  if (replacing) {
    // On prend la place de la precedente, y compris dans l'historique.
    const at = stack.indexOf(replacing);
    if (at !== -1) stack.splice(at, 1);
    replacing.dialog.close();
    replacing.dialog.remove();
    replacing.onClose?.();
    try {
      history.replaceState({ ...(history.state || {}), gvSheet: entry.key }, '');
    } catch {
      /* historique indisponible : la fenetre se fermera par ses boutons */
    }
  } else {
    try {
      history.pushState({ ...(history.state || {}), gvSheet: entry.key }, '');
    } catch {
      /* idem */
    }
  }
  stack.push(entry);

  dialog.showModal();
  // Le focus initial ne doit pas faire sauter le clavier du telephone : on
  // vise par defaut la fenetre elle-meme, pas son premier champ.
  const target = focus ? dialog.querySelector(focus) : null;
  (target || body).focus?.({ preventScroll: true });

  const close = () => {
    // Deux demandes de fermeture coup sur coup (le bouton, puis la mise a
    // jour qui suit une suppression) ne doivent reculer qu'une fois dans
    // l'historique : la seconde ferait quitter la page.
    if (!stack.includes(entry) || entry.closing) return;
    entry.closing = true;
    if (history.state?.gvSheet === entry.key) {
      history.back();
      // Filet : si le navigateur ne signale pas le retour, on ferme quand meme.
      setTimeout(() => finalize(entry), 600);
    } else {
      finalize(entry);
    }
  };

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
    else if (event.target.closest('[data-close]')) close();
  });

  return {
    el: dialog,
    close,
    $: (selector) => dialog.querySelector(selector),
    swap: (options) => openSheet({ ...options, replacing: entry }),
  };
}

/**
 * Confirmation, resolue par une promesse. `danger` place le focus sur
 * « Annuler » : une touche Entree restee sous le doigt ne supprime rien.
 */
export function confirmSheet({ title, message, confirmLabel = 'Confirmer', danger = false, subject = null }) {
  return new Promise((resolve) => {
    let answer = false;
    const sheet = openSheet({
      className: 'sheet--confirm',
      label: title,
      content: `
        <div class="sheet-body confirm" tabindex="-1">
          <h2 class="confirm-title">${esc(title)}</h2>
          <p class="confirm-text">${esc(message)}</p>
          ${subject ? `<div class="confirm-subject"><strong>${esc(subject.name)}</strong>
            ${subject.ref ? `<span class="mono">${esc(subject.ref)}</span>` : ''}</div>` : ''}
          <div class="confirm-actions">
            <button type="button" class="btn" data-close data-role="cancel">Annuler</button>
            <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-role="ok">${esc(confirmLabel)}</button>
          </div>
        </div>`,
      onClose: () => resolve(answer),
      focus: danger ? '[data-role="cancel"]' : '[data-role="ok"]',
    });
    sheet.$('[data-role="ok"]').addEventListener('click', () => {
      answer = true;
      sheet.close();
    });
  });
}
