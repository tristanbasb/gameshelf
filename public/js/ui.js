/** Helpers d'interface : echappement, notifications, modales, formatage. */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Acces protege a localStorage : navigation privee, cookies bloques ou
 * contexte restreint peuvent le rendre indisponible, et une lecture non
 * gardee ferait echouer tout le demarrage de l'application.
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
      /* stockage indisponible : la preference ne sera pas memorisee */
    }
  },
};

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Echappe une valeur avant insertion dans du HTML genere. */
export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

/* -------------------------------------------------------------------------- */
/* Libelles metier                                                            */
/* -------------------------------------------------------------------------- */

/*
 * Echelle d'etat, du meilleur au plus abime. Les libelles reprennent le
 * vocabulaire courant des inventaires de collection (Tres bon, Bon,
 * Acceptable, Mauvais), ce qui rend les imports lisibles sans traduction.
 */
export const CONDITION_LABELS = {
  sealed: 'Neuf, sous blister',
  mint: 'Très bon',
  good: 'Bon',
  fair: 'Acceptable',
  poor: 'Mauvais',
  '': 'État non renseigné',
};

/** Version courte, pour les badges des cartes et du tableau. */
export const CONDITION_SHORT = {
  sealed: 'Neuf',
  mint: 'Très bon',
  good: 'Bon',
  fair: 'Acceptable',
  poor: 'Mauvais',
  '': '—',
};

export const CONDITION_COLORS = {
  sealed: 'var(--cond-sealed)',
  mint: 'var(--cond-mint)',
  good: 'var(--cond-good)',
  fair: 'var(--cond-fair)',
  poor: 'var(--cond-poor)',
  '': 'var(--text-faint)',
};

/** Elements suivis dans un exemplaire, dans l'ordre d'affichage. */
export const PARTS = [
  { key: 'has_box', label: 'Boîte', missing: 'boîte' },
  { key: 'has_cover_art', label: 'Jaquette papier', missing: 'jaquette' },
  { key: 'has_manual', label: 'Notice', missing: 'notice' },
  { key: 'has_disc', label: 'Disque / cartouche', missing: 'disque' },
];

/** Liste des elements absents d'un exemplaire (vide s'il est complet). */
export function missingParts(game) {
  return PARTS.filter((part) => !game[part.key]).map((part) => part.missing);
}

const nf = new Intl.NumberFormat('fr-FR');
const cf = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export const fmtNumber = (n) => nf.format(Number(n) || 0);
export const fmtMoney = (n) => cf.format(Number(n) || 0);

export function fmtDate(value) {
  if (!value) return '';
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('fr-FR');
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Notification passagere. `action` ajoute un bouton dans la notification —
 * c'est ce qui permet de proposer « Annuler » juste apres une suppression,
 * au moment exact ou l'on s'apercoit de l'erreur.
 */
export function toast(message, type = 'success', { duration = 4000, action } = {}) {
  const container = $('#toasts');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast ${type}`;

  const text = document.createElement('span');
  text.textContent = message;
  text.style.flex = '1';
  el.appendChild(text);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
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

  container.appendChild(el);
  timer = setTimeout(dismiss, duration);
}

/* -------------------------------------------------------------------------- */
/* Modales                                                                    */
/* -------------------------------------------------------------------------- */

let openModals = 0;

/**
 * Instancie un <template> de modale, l'ajoute au DOM et renvoie
 * { root, close } pour la manipuler.
 */
export function openModal(templateId, { onClose } = {}) {
  const template = document.getElementById(templateId);
  if (!template) throw new Error(`Template introuvable : ${templateId}`);

  const fragment = template.content.cloneNode(true);
  const root = fragment.firstElementChild;
  document.body.appendChild(root);

  openModals += 1;
  document.body.style.overflow = 'hidden';
  const previouslyFocused = document.activeElement;

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    root.remove();
    openModals = Math.max(openModals - 1, 0);
    if (openModals === 0) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKeydown);
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    onClose?.();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) close();
    else if (event.target === root && root.hasAttribute('data-close-on-backdrop')) close();
  });
  document.addEventListener('keydown', onKeydown);

  // Focus sur le premier champ utile.
  const firstField = root.querySelector('input:not([type=hidden]), select, textarea, button');
  firstField?.focus();

  return { root, close, $: (selector) => root.querySelector(selector) };
}

/** Boite de dialogue de confirmation, resolue par une promesse. */
export function confirmDialog(message, { confirmLabel = 'Confirmer', title = 'Confirmation' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal('tpl-confirm-modal', {
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
    modal.$('#confirm-title').textContent = title;
    modal.$('#confirm-text').textContent = message;

    const okButton = modal.$('#confirm-ok');
    okButton.textContent = confirmLabel;
    okButton.focus();
    okButton.addEventListener('click', () => {
      answered = true;
      modal.close();
      resolve(true);
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Divers                                                                     */
/* -------------------------------------------------------------------------- */

export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Premiere lettre d'un titre, utilisee comme jaquette de secours. */
export const initial = (title) => (String(title || '?').trim()[0] || '?').toUpperCase();
