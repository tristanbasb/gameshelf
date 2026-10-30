/*
 * Discuter avec Claude.
 *
 * Claude repond sur la collection, qu'il consulte lui-meme, et sur le reste —
 * cotes, dates de sortie, conseils — en cherchant sur le web. Sa reponse
 * s'ecrit au fil de l'eau ; un jeu qu'il cite est un lien vers sa fiche.
 *
 * La conversation affichee est gardee sur l'appareil : refermer la fenetre ne
 * la perd pas. Claude, lui, s'en souvient tant que le service tourne ; s'il
 * l'a oubliee, la question suivante repart de zero, et la fenetre le dit.
 */

import { esc, icon, openSheet, store } from './ui.js';
import { actions } from './actions.js';

const STORE_KEY = 'gv-chat';

/** Messages gardes sur l'appareil, au plus. */
const GARDES = 60;

const SUGGESTIONS = [
  'Quels jeux PS2 n’ont pas leur notice ?',
  'Combien de jeux ai-je sous blister ?',
  'Lesquels ai-je en plusieurs exemplaires ?',
  'Que vaut à peu près ma collection Nintendo 64 ?',
];

/* -------------------------------------------------------------------------- */
/* Markdown                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * Le strict necessaire pour les reponses : gras, italique, code, liens et
 * listes. Le texte est echappe avant toute mise en forme : rien de ce que
 * renvoie le modele ne devient du HTML actif. Les liens vers une fiche
 * (#jeu-123) deviennent des boutons ; les autres s'ouvrent ailleurs.
 */
function inline(text) {
  return esc(text)
    .replace(/\[([^\]]+)\]\((#jeu-(\d+)|https?:\/\/[^\s)]+)\)/g, (_, label, href, id) => (id
      ? `<button type="button" class="chat-game" data-game="${id}">${label}</button>`
      : `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdown(text) {
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || number) {
      flushPara();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((bullet || number)[1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      // Un titre devient une ligne en gras : la fenetre n'a pas la place d'une hierarchie.
      para.push(line.replace(/^#{1,6}\s+(.*)$/, '**$1**'));
    }
  }
  flushPara();
  flushList();
  return out.join('');
}

/* -------------------------------------------------------------------------- */
/* Echanges avec le serveur                                                   */
/* -------------------------------------------------------------------------- */

/** Evenements d'un flux `text/event-stream`, un par un. */
async function* readEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf('\n\n');
    while (cut !== -1) {
      const raw = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = 'message';
      const data = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      // Les commentaires (« : ping ») n'ont pas de donnees : on les ignore.
      if (data.length) {
        try {
          yield { event, data: JSON.parse(data.join('\n')) };
        } catch {
          /* morceau illisible : le suivant reprendra */
        }
      }
      cut = buffer.indexOf('\n\n');
    }
  }
}

function activityLabel({ kind, query }) {
  if (kind === 'web') return 'Cherche sur le web…';
  if (kind === 'stats') return 'Compte la collection…';
  return query ? `Consulte la collection : « ${query} »…` : 'Consulte la collection…';
}

function load() {
  try {
    const saved = JSON.parse(store.get(STORE_KEY) || 'null');
    if (saved && Array.isArray(saved.items)) return { id: saved.id || '', model: saved.model || '', items: saved.items };
  } catch {
    /* copie illisible : on repart d'une conversation vide */
  }
  return { id: '', model: '', items: [] };
}

function save(state) {
  store.set(STORE_KEY, JSON.stringify({
    id: state.id,
    model: state.model,
    // L'etat d'une reponse en cours n'a pas a survivre a la fenetre.
    items: state.items.slice(-GARDES).map(({ streaming: _streaming, activity: _activity, ...item }) => item),
  }));
}

/* -------------------------------------------------------------------------- */
/* Fenetre                                                                    */
/* -------------------------------------------------------------------------- */

function itemMarkup(item) {
  if (item.role === 'user') {
    return `<div class="msg msg--user"><p>${esc(item.text).replace(/\n/g, '<br>')}</p></div>`;
  }
  const sources = item.sources?.length
    ? `<div class="msg-sources">${item.sources.map((s) => {
      let host = '';
      try {
        host = new URL(s.url).hostname.replace(/^www\./, '');
      } catch {
        /* adresse illisible : le titre suffira */
      }
      return `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title)}">${esc(host || s.title)}</a>`;
    }).join('')}</div>`
    : '';
  return `<div class="msg msg--claude">
    ${item.notice ? `<p class="msg-notice">${esc(item.notice)}</p>` : ''}
    ${item.text ? `<div class="msg-text">${markdown(item.text)}</div>` : ''}
    ${item.streaming ? `<p class="msg-activity"><span class="msg-dot"></span>${esc(item.activity || (item.text ? '' : 'Claude réfléchit…'))}</p>` : ''}
    ${item.stopped ? '<p class="msg-notice">Réponse interrompue.</p>' : ''}
    ${item.error ? `<p class="form-error">${esc(item.error)}</p>` : ''}
    ${sources}
  </div>`;
}

const emptyMarkup = () => `<div class="chat-empty">
  <p class="chat-empty-title">${icon('spark', { size: 20 })}Discuter avec Claude</p>
  <p>Posez une question sur votre collection : Claude la consulte pour vous répondre. Il cherche aussi en ligne les cotes, les dates de sortie ou les éditions. Il ne modifie rien.</p>
  <div class="suggest">${SUGGESTIONS.map((s) => `<button type="button" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>
</div>`;

/* Le modele de la conversation ; avant le premier message, celui choisi dans le menu. */
function modelName(state) {
  const { models } = actions.instance;
  const name = state.model || models?.choices.find((m) => m.id === models.chat)?.name || '';
  return name.replace(/^Claude /, '');
}

export function openChat() {
  const state = load();
  let pending = null;

  const sheet = openSheet({
    className: 'sheet--chat',
    label: 'Discuter avec Claude',
    content: `<div class="sheet-wrap">
      <div class="sheet-head">
        <h2 class="sheet-title">Claude <span class="chat-model" data-model-name>${esc(modelName(state))}</span></h2>
        <button type="button" class="icon-btn" data-new title="Nouvelle conversation" aria-label="Nouvelle conversation">${icon('edit')}</button>
        <button type="button" class="icon-btn" data-close aria-label="Fermer">${icon('close')}</button>
      </div>
      <div class="sheet-body chat-log" data-log></div>
      <form class="chat-compose" data-form novalidate>
        <textarea class="textarea" name="message" rows="1" maxlength="4000" enterkeyhint="send"
          placeholder="Une question sur votre collection…" aria-label="Message pour Claude"></textarea>
        <button type="submit" class="btn btn--primary btn--icon" data-send aria-label="Envoyer">${icon('send')}</button>
      </form>
    </div>`,
    // Sur ordinateur, on tape tout de suite ; sur telephone, le clavier
    // recouvrirait la conversation.
    focus: window.matchMedia('(pointer: fine)').matches ? 'textarea' : null,
    onClose: () => pending?.abort(),
  });

  const log = sheet.$('[data-log]');
  const form = sheet.$('[data-form]');
  const input = form.elements.message;
  const sendButton = sheet.$('[data-send]');
  const showModel = () => {
    sheet.$('[data-model-name]').textContent = modelName(state);
  };

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const toBottom = () => {
    log.scrollTop = log.scrollHeight;
  };

  function renderAll() {
    log.innerHTML = state.items.length ? state.items.map(itemMarkup).join('') : emptyMarkup();
    toBottom();
  }

  // La reponse en cours est redessinee une fois par image, pas a chaque morceau.
  let frame = 0;
  function renderLast() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const follow = nearBottom();
      const last = log.lastElementChild;
      const item = state.items.at(-1);
      if (!last || !item) return renderAll();
      last.outerHTML = itemMarkup(item);
      if (follow) toBottom();
    });
  }

  function setBusy(busy) {
    sendButton.innerHTML = icon(busy ? 'stop' : 'send');
    sendButton.setAttribute('aria-label', busy ? 'Arrêter la réponse' : 'Envoyer');
    sendButton.classList.toggle('btn--primary', !busy);
  }

  async function stream(text, reply, signal, retried = false) {
    const response = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ conversation: state.id, message: text }),
      signal,
    });
    if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 404 && payload.forgotten && !retried) {
        // Le service a redemarre : la question repart dans une conversation neuve.
        state.id = '';
        state.model = '';
        reply.notice = 'Claude a oublié la conversation précédente (le serveur a redémarré) : il repart de zéro.';
        renderLast();
        return stream(text, reply, signal, true);
      }
      reply.error = payload.error || `Erreur ${response.status}`;
      return undefined;
    }
    for await (const { event, data } of readEvents(response.body)) {
      if (event === 'conversation') {
        state.id = data.id;
        state.model = data.model || '';
        showModel();
      } else if (event === 'text') {
        reply.text += data.t;
        reply.activity = '';
      } else if (event === 'activity') {
        reply.activity = activityLabel(data);
      } else if (event === 'sources') {
        const known = new Set((reply.sources || []).map((s) => s.url));
        reply.sources = [...(reply.sources || []), ...data.sources.filter((s) => !known.has(s.url))];
      } else if (event === 'error') {
        reply.error = data.error;
      }
      renderLast();
    }
    return undefined;
  }

  async function send(text) {
    const message = text.trim();
    if (!message || pending) return;
    const reply = { role: 'assistant', text: '', streaming: true };
    if (!state.items.length) log.innerHTML = '';
    state.items.push({ role: 'user', text: message }, reply);
    log.insertAdjacentHTML('beforeend', itemMarkup(state.items.at(-2)) + itemMarkup(reply));
    toBottom();
    input.value = '';
    autosize();

    const controller = new AbortController();
    pending = controller;
    setBusy(true);
    try {
      await stream(message, reply, controller.signal);
    } catch {
      if (controller.signal.aborted) reply.stopped = true;
      else reply.error = 'Connexion au serveur impossible : vérifiez le réseau.';
    } finally {
      pending = null;
      reply.streaming = false;
      reply.activity = '';
      setBusy(false);
      save(state);
      if (sheet.el.isConnected) renderLast();
    }
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending) pending.abort();
    else send(input.value);
  });
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (event) => {
    // Entree envoie, Maj+Entree passe a la ligne.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!pending) send(input.value);
    }
  });

  sheet.el.addEventListener('click', (event) => {
    const game = event.target.closest('[data-game]');
    if (game) {
      // Par-dessus la discussion : le retour y ramene.
      actions.openDetail(Number(game.dataset.game));
      return;
    }
    const suggestion = event.target.closest('[data-suggest]');
    if (suggestion) {
      send(suggestion.dataset.suggest);
      return;
    }
    if (event.target.closest('[data-new]')) {
      pending?.abort();
      state.id = '';
      state.model = '';
      state.items = [];
      save(state);
      showModel();
      renderAll();
      input.focus({ preventScroll: true });
    }
  });

  renderAll();
  return sheet;
}
