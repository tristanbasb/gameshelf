/*
 * Discussion avec Claude.
 *
 * Claude repond aux questions sur la collection — « quels jeux PS2 n'ont pas
 * leur notice ? », « combien de Mario sous blister ? » — et au-dela : cotes,
 * dates de sortie, conseils. Il ne connait pas la collection d'avance : il la
 * consulte avec deux outils en lecture seule, et cherche sur le web le reste.
 * Il ne peut rien modifier.
 *
 * La reponse arrive au fil de l'eau (evenements serveur) : le texte, ce que
 * Claude est en train de consulter, puis les sources. Les conversations sont
 * gardees en memoire, le temps d'une soiree : un redemarrage du service les
 * oublie, et l'interface en recommence une.
 */
import crypto from 'node:crypto';
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { db, normalizeForSearch } from './db.js';
import { config } from './config.js';

const MODELE = 'claude-opus-5-5';
const EFFORT = 'medium';

/** Recherches web permises par etape : chacune est facturee. */
const RECHERCHES_MAX = 3;

/** Etapes au plus pour repondre a un message : outils, recherches, reprises. */
const ETAPES_MAX = 8;

/** Au-dela, la conversation est trop longue : on en commence une autre. */
const MESSAGES_MAX = 80;

/** Une conversation inactive est oubliee au bout de douze heures. */
const OUBLI_MS = 12 * 60 * 60 * 1000;
const CONVERSATIONS_MAX = 40;

const DELAI_MS = 120_000;

/** Echec d'une reponse, avec le message a montrer. */
export class ErreurDiscussion extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/* --------------------------------------------------------------------------
 * Consignes et outils
 * ----------------------------------------------------------------------- */

const SYSTEME = `Tu es l'assistant de GameVault, l'inventaire personnel d'une collection de jeux vidéo physiques. Tu discutes avec son propriétaire, en français.

- Pour toute question sur sa collection, consulte-la avec chercher_jeux et statistiques_collection. Ne cite jamais un jeu que les outils n'ont pas renvoyé, et ne devine pas un chiffre que tu peux compter.
- Quand tu nommes un jeu de la collection, fais-en un lien vers sa fiche : [Titre](#jeu-ID), avec l'identifiant renvoyé par l'outil.
- Pour les cotes, les prix, les dates de sortie ou l'actualité, cherche sur le web. Une cote est une estimation datée : dis-le.
- Tu ne peux pas modifier la collection. Pour ajouter, corriger ou supprimer un jeu, indique le geste dans l'application : le bouton Ajouter, la fiche du jeu, le scanner.
- Réponds brièvement, en Markdown simple : paragraphes courts, listes, gras, liens. Pas de tableaux ni de titres.

États d'un exemplaire : sealed = neuf sous blister, mint = très bon, good = bon, fair = acceptable, poor = mauvais, none = non renseigné.`;

const ETATS = ['sealed', 'mint', 'good', 'fair', 'poor', 'none'];
const PIECES = { box: 'has_box', cover_art: 'has_cover_art', manual: 'has_manual', disc: 'has_disc' };
const PIECES_FR = { has_box: 'boîte', has_cover_art: 'jaquette', has_manual: 'notice', has_disc: 'disque' };

const OUTILS = [
  {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: RECHERCHES_MAX,
    user_location: { type: 'approximate', country: 'FR' },
  },
  {
    name: 'chercher_jeux',
    description: 'Cherche dans la collection de l’utilisateur et renvoie les fiches trouvées (identifiant, titre, plateforme, région, état, pièces manquantes, ISO, favori, serial, code-barres, tags, notes, date d’ajout) et leur nombre total. Sans aucun critère, parcourt toute la collection dans la limite demandée. Les critères se combinent.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Mots cherchés dans le titre, la plateforme, la région, le serial, le code-barres, les tags et les notes, sans accents ni casse ; chaque mot doit apparaître.',
        },
        platform: { type: 'string', description: 'Plateforme, telle qu’elle est nommée dans la collection (voir statistiques_collection).' },
        condition: { type: 'string', enum: ETATS },
        missing: {
          type: 'string',
          enum: [...Object.keys(PIECES), 'any'],
          description: 'Exemplaires auxquels il manque cette pièce ; any = au moins une pièce manquante.',
        },
        favorite: { type: 'boolean', description: 'true : seulement les favoris.' },
        iso: { type: 'string', enum: ['with', 'without'], description: 'Avec ou sans sauvegarde ISO.' },
        sort: { type: 'string', enum: ['title', 'platform', 'recent'], description: 'Ordre des fiches renvoyées.' },
        limit: { type: 'integer', description: 'Nombre de fiches renvoyées, 50 par défaut, 200 au plus.' },
      },
      required: [],
    },
  },
  {
    name: 'statistiques_collection',
    description: 'Chiffres de la collection : totaux, répartition par plateforme, état et région, pièces manquantes, doublons, tags les plus fréquents, derniers ajouts.',
    eager_input_streaming: true,
    input_schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  },
];

/* --------------------------------------------------------------------------
 * Execution des outils
 * ----------------------------------------------------------------------- */

const ORDRES = {
  title: 'title COLLATE NOCASE',
  platform: 'platform COLLATE NOCASE, title COLLATE NOCASE',
  recent: 'created_at DESC, id DESC',
};

const plateformes = db.prepare("SELECT DISTINCT platform FROM games WHERE platform <> ''");

/*
 * Avec la diffusion au fil de l'eau des arguments, l'API ne les verifie plus :
 * on le fait ici, et une saisie invalide revient a Claude comme une erreur
 * qu'il peut corriger.
 */
function lireCriteres(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const chaine = (v) => v === undefined || typeof v === 'string';
  if (!chaine(input.query) || !chaine(input.platform)) return null;
  if (input.condition !== undefined && !ETATS.includes(input.condition)) return null;
  if (input.missing !== undefined && !(input.missing in PIECES) && input.missing !== 'any') return null;
  if (input.favorite !== undefined && typeof input.favorite !== 'boolean') return null;
  if (input.iso !== undefined && !['with', 'without'].includes(input.iso)) return null;
  if (input.sort !== undefined && !(input.sort in ORDRES)) return null;
  if (input.limit !== undefined && !Number.isInteger(input.limit)) return null;
  return input;
}

function chercherJeux(criteres) {
  const where = [];
  const params = {};

  const mots = normalizeForSearch(criteres.query || '').split(/\s+/).filter(Boolean).slice(0, 8);
  mots.forEach((mot, i) => {
    where.push(`search_text LIKE @mot${i}`);
    params[`mot${i}`] = `%${mot}%`;
  });
  if (criteres.platform) {
    // Claude ecrit « PlayStation 2 » quand la collection dit « PS2 » : un nom
    // inconnu rejoint les mots cherches plutot que de ne rien trouver.
    const connue = plateformes.all().map((r) => r.platform)
      .find((p) => p.toLowerCase() === criteres.platform.trim().toLowerCase());
    if (connue) {
      where.push('platform = @platform');
      params.platform = connue;
    } else {
      normalizeForSearch(criteres.platform).split(/\s+/).filter(Boolean).forEach((mot, i) => {
        where.push(`search_text LIKE @plat${i}`);
        params[`plat${i}`] = `%${mot}%`;
      });
    }
  }
  if (criteres.condition) {
    where.push('condition = @condition');
    params.condition = criteres.condition === 'none' ? '' : criteres.condition;
  }
  if (criteres.missing === 'any') where.push(`(${Object.values(PIECES).map((c) => `${c} = 0`).join(' OR ')})`);
  else if (criteres.missing) where.push(`${PIECES[criteres.missing]} = 0`);
  if (criteres.favorite) where.push('favorite = 1');
  if (criteres.iso) where.push(`has_iso = ${criteres.iso === 'with' ? 1 : 0}`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limite = Math.min(Math.max(criteres.limit || 50, 1), 200);
  // better-sqlite3 refuse un objet de parametres pour une requete qui n'en
  // attend aucun : sans critere, on n'en passe pas.
  const avec = Object.keys(params).length ? [params] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM games ${whereSql}`).get(...avec).n;
  const lignes = db.prepare(
    `SELECT id, title, platform, region, condition, quantity, has_box, has_cover_art, has_manual,
            has_disc, has_iso, favorite, serial, ean, tags, notes, created_at
       FROM games ${whereSql} ORDER BY ${ORDRES[criteres.sort] || ORDRES.title} LIMIT ${limite}`,
  ).all(...avec);

  return {
    total,
    returned: lignes.length,
    games: lignes.map((g) => ({
      id: g.id,
      title: g.title,
      platform: g.platform,
      region: g.region,
      condition: g.condition || 'none',
      quantity: g.quantity,
      missing: Object.values(PIECES).filter((c) => !g[c]).map((c) => PIECES_FR[c]),
      iso: Boolean(g.has_iso),
      favorite: Boolean(g.favorite),
      serial: g.serial,
      ean: g.ean,
      tags: g.tags,
      notes: g.notes.length > 300 ? `${g.notes.slice(0, 300)}…` : g.notes,
      added: g.created_at.slice(0, 10),
    })),
  };
}

function statistiques() {
  const totaux = db.prepare(
    `SELECT COUNT(*) AS games, COALESCE(SUM(quantity), 0) AS copies,
            SUM(favorite = 1) AS favorites, SUM(has_iso = 0) AS without_iso,
            SUM(quantity > 1) AS duplicates,
            SUM(has_box = 0) AS no_box, SUM(has_cover_art = 0) AS no_cover_art,
            SUM(has_manual = 0) AS no_manual, SUM(has_disc = 0) AS no_disc,
            SUM(has_box = 0 OR has_cover_art = 0 OR has_manual = 0 OR has_disc = 0) AS incomplete
       FROM games`,
  ).get();
  const repartition = (colonne) => db.prepare(
    `SELECT ${colonne} AS value, COUNT(*) AS games FROM games GROUP BY ${colonne} ORDER BY games DESC`,
  ).all().map((r) => ({ value: r.value || (colonne === 'condition' ? 'none' : '(vide)'), games: r.games }));

  const tags = new Map();
  for (const { tags: liste } of db.prepare("SELECT tags FROM games WHERE tags <> ''").all()) {
    for (const tag of liste.split(',').map((t) => t.trim()).filter(Boolean)) tags.set(tag, (tags.get(tag) || 0) + 1);
  }

  return {
    totals: Object.fromEntries(Object.entries(totaux).map(([k, v]) => [k, v || 0])),
    by_platform: repartition('platform'),
    by_condition: repartition('condition'),
    by_region: repartition('region'),
    top_tags: [...tags].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([tag, games]) => ({ tag, games })),
    recent: db.prepare('SELECT id, title, platform, created_at FROM games ORDER BY created_at DESC, id DESC LIMIT 5')
      .all().map((g) => ({ id: g.id, title: g.title, platform: g.platform, added: g.created_at.slice(0, 10) })),
  };
}

/** Execute un appel d'outil et rend son resultat, pret a renvoyer a Claude. */
function executer(appel, annoncer) {
  const resultat = (contenu, erreur = false) => ({
    type: 'tool_result',
    tool_use_id: appel.id,
    content: JSON.stringify(contenu),
    ...(erreur ? { is_error: true } : {}),
  });
  try {
    if (appel.name === 'chercher_jeux') {
      const criteres = lireCriteres(appel.input);
      if (!criteres) return resultat({ INVALID_INPUT: appel.input }, true);
      annoncer({ kind: 'collection', query: criteres.query || criteres.platform || '' });
      return resultat(chercherJeux(criteres));
    }
    if (appel.name === 'statistiques_collection') {
      annoncer({ kind: 'stats' });
      return resultat(statistiques());
    }
    return resultat({ error: `Outil inconnu : ${appel.name}` }, true);
  } catch (err) {
    return resultat({ error: err.message }, true);
  }
}

/* --------------------------------------------------------------------------
 * Conversations
 * ----------------------------------------------------------------------- */

const conversations = new Map();

function oublierLesAnciennes() {
  const limite = Date.now() - OUBLI_MS;
  for (const [id, c] of conversations) if (c.vue < limite && !c.occupee) conversations.delete(id);
  // Les plus anciennes partent d'abord : une Map garde l'ordre d'insertion.
  while (conversations.size > CONVERSATIONS_MAX) conversations.delete(conversations.keys().next().value);
}

/** La conversation demandee, une nouvelle si `id` est vide, ou null si elle a ete oubliee. */
export function conversation(id) {
  oublierLesAnciennes();
  if (id) return conversations.get(id) || null;
  const nouvelle = { id: crypto.randomUUID(), messages: [], vue: Date.now(), occupee: false };
  conversations.set(nouvelle.id, nouvelle);
  return nouvelle;
}

/* --------------------------------------------------------------------------
 * Reponse
 * ----------------------------------------------------------------------- */

let client = null;
const claude = () => {
  client ??= new Anthropic({ apiKey: config.anthropicApiKey, timeout: DELAI_MS, maxRetries: 1 });
  return client;
};

function traduireErreur(err) {
  if (err instanceof ErreurDiscussion) return err;
  if (err instanceof APIUserAbortError) return new ErreurDiscussion('Reponse interrompue', 499);
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return new ErreurDiscussion('Cle Anthropic refusee : verifiez ANTHROPIC_API_KEY dans le fichier .env', 503);
  }
  if (err instanceof RateLimitError) return new ErreurDiscussion('Quota Anthropic atteint : reessayez dans quelques minutes', 503);
  if (err instanceof APIConnectionTimeoutError) return new ErreurDiscussion('Claude n a pas repondu a temps : reessayez', 504);
  if (err instanceof APIConnectionError) return new ErreurDiscussion('Service Anthropic injoignable depuis le serveur', 502);
  if (err instanceof BadRequestError) {
    console.warn(`  ! Requete refusee par Anthropic : ${err.message}`);
    return new ErreurDiscussion('Requete refusee par Anthropic (details dans le journal du serveur)', 502);
  }
  if (err instanceof APIError) return new ErreurDiscussion(`Le service Anthropic a repondu ${err.status ?? 'une erreur'}`, 502);
  return err;
}

/** Sources citees par les blocs de texte d'une reponse, sans doublon. */
function sourcesDe(content) {
  const vues = new Map();
  for (const block of content) {
    if (block.type !== 'text' || !Array.isArray(block.citations)) continue;
    for (const c of block.citations) {
      if (c?.url && !vues.has(c.url)) vues.set(c.url, { url: c.url, title: c.title || '' });
    }
  }
  return [...vues.values()].slice(0, 8);
}

/**
 * Repond a `texte` dans la conversation `conv`. `envoyer(evenement, donnees)`
 * transmet au navigateur : `text` (un morceau de reponse), `activity` (ce que
 * Claude consulte), `sources`. `signal` interrompt la reponse.
 *
 * En cas d'echec ou d'interruption, la conversation reprend l'etat d'avant ce
 * message : jamais d'appel d'outil laisse sans resultat, que l'API refuserait
 * au message suivant.
 */
export async function repondre(conv, texte, envoyer, signal) {
  if (conv.messages.length >= MESSAGES_MAX) {
    throw new ErreurDiscussion('Conversation trop longue : commencez-en une nouvelle', 413);
  }
  conv.occupee = true;
  conv.vue = Date.now();
  const avant = conv.messages.length;
  conv.messages.push({ role: 'user', content: texte });

  const usage = { lus: 0, caches: 0, ecrits: 0, recherches: 0 };
  let texteEnvoye = false;
  let illisibles = 0;
  try {
    for (let etape = 0; etape < ETAPES_MAX; etape += 1) {
      const flux = claude().beta.messages.stream({
        model: MODELE,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: EFFORT },
        // Consignes, outils et debut de conversation sont relus a chaque
        // message : la mise en cache en divise le cout.
        cache_control: { type: 'ephemeral' },
        system: SYSTEME,
        tools: OUTILS,
        messages: conv.messages,
      }, { signal });

      let message;
      try {
        for await (const evenement of flux) {
          if (evenement.type === 'content_block_start') {
            const bloc = evenement.content_block;
            if (bloc.type === 'server_tool_use' && bloc.name === 'web_search') envoyer('activity', { kind: 'web' });
            // Deux blocs de texte successifs forment deux paragraphes.
            if (bloc.type === 'text' && texteEnvoye) envoyer('text', { t: '\n\n' });
          } else if (evenement.type === 'content_block_delta' && evenement.delta.type === 'text_delta') {
            envoyer('text', { t: evenement.delta.text });
            texteEnvoye = true;
          }
        }
        message = await flux.finalMessage();
        illisibles = 0;
      } catch (err) {
        // Seuls des arguments d'outil illisibles justifient de rejouer l'etape.
        if (err instanceof APIError || err instanceof APIUserAbortError || signal?.aborted || illisibles >= 2) throw err;
        illisibles += 1;
        continue;
      }

      usage.lus += message.usage?.input_tokens || 0;
      usage.caches += message.usage?.cache_read_input_tokens || 0;
      usage.ecrits += message.usage?.output_tokens || 0;
      usage.recherches += message.usage?.server_tool_use?.web_search_requests || 0;

      // Un refus peut couper un appel d'outil en plein milieu : rien de cette
      // etape n'est execute.
      if (message.stop_reason === 'refusal') throw new ErreurDiscussion('Claude a refuse de repondre a ce message', 422);

      conv.messages.push({ role: 'assistant', content: message.content });
      const sources = sourcesDe(message.content);
      if (sources.length) envoyer('sources', { sources });
      if (message.stop_reason === 'pause_turn') continue;

      const appels = message.content.filter((b) => b.type === 'tool_use');
      if (!appels.length) {
        console.log(
          `  Discussion : ${usage.lus + usage.caches} jetons lus (dont ${usage.caches} en cache), `
          + `${usage.ecrits} ecrits, ${usage.recherches} recherche(s)`,
        );
        return;
      }
      if (message.stop_reason === 'max_tokens') throw new ErreurDiscussion('Reponse interrompue avant sa fin', 502);
      conv.messages.push({
        role: 'user',
        content: appels.map((appel) => executer(appel, (activite) => envoyer('activity', activite))),
      });
    }
    throw new ErreurDiscussion('Claude n a pas abouti en un nombre raisonnable d etapes : reformulez la question', 502);
  } catch (err) {
    conv.messages.length = avant;
    throw traduireErreur(err);
  } finally {
    conv.occupee = false;
    conv.vue = Date.now();
  }
}
