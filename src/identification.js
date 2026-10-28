/*
 * Identification d'un jeu par Claude.
 *
 * Devant un boitier, on a une photo, un code-barres et parfois un serial —
 * pas le titre exact de l'edition, ni sa region. Claude lit la photo, cherche
 * le code-barres sur le web, recoupe, et propose une fiche.
 *
 * Une proposition n'est pas une preuve. Ce module ne prend donc pas Claude au
 * mot : il verifie lui-meme ce qui peut l'etre, et c'est cette verification,
 * pas l'assurance du modele, qui donne le verdict.
 *   - la clef de controle du code-barres ;
 *   - l'accord entre le code-barres fourni, celui que Claude lit sur la photo
 *     et celui qu'il propose — de meme pour le serial et la region ;
 *   - les sources : seules comptent celles que la recherche a reellement
 *     renvoyees. Une adresse citee sans en provenir est ecartee.
 * Le verdict n'est « confirme » que si une source relie ce code-barres a ce
 * titre et que rien ne le contredit. Et quel qu'il soit, rien n'est enregistre
 * sans que l'utilisateur ait valide la fiche.
 *
 * La photo part chez Anthropic pour l'analyse ; elle n'est pas gardee ici.
 */
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { db } from './db.js';
import { config } from './config.js';
import { eanVariants } from './games.js';
import { typeImageReel } from './images.js';

const MODELE = 'claude-opus-5-5';

/*
 * Effort moyen : lire une photo, chercher un code et recouper trois indices
 * ne demande pas davantage, et chaque identification reste rapide et peu
 * couteuse.
 */
const EFFORT = 'medium';

/** Recherches web permises par identification : chacune est facturee. */
const RECHERCHES_MAX = 5;

/** Une identification prend 10 a 40 secondes ; au-dela, on abandonne. */
const DELAI_MS = 110_000;

/*
 * Plus grand cote de la photo envoyee. Les petits caracteres du dos — serial,
 * chiffres sous le code-barres — restent lisibles, et l'image ne coute que
 * quelques milliers de jetons.
 */
const COTE_MAX = 2000;

/** Types d'image que l'API accepte tels quels. */
const TYPES_ACCEPTES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Tours de conversation au plus : recherches en pause, relance si Claude ne conclut pas. */
const TOURS_MAX = 4;

let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  /* sans reduction possible, la photo part telle quelle si son type le permet */
}

/** Echec d'identification, avec le code HTTP a renvoyer. */
export class ErreurIdentification extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/* --------------------------------------------------------------------------
 * Consignes
 * ----------------------------------------------------------------------- */

const SYSTEME = `Tu identifies un jeu vidéo physique pour l'inventaire d'un collectionneur, à partir d'une photo — face avant, dos, tranche, disque ou cartouche — et/ou de son code-barres, et parfois de son serial éditeur.

Démarche :
1. Relève ce que la photo montre réellement : titre, plateforme (logo, bandeau), mentions de région (PEGI ou USK pour PAL, ESRB pour NTSC-U, CERO pour NTSC-J), serial, chiffres imprimés sous le code-barres. Ne note dans seen_on_photo que ce que tu lis effectivement ; laisse vide ce qui n'est pas visible ou pas lisible. Sans photo, seen_on_photo reste entièrement vide.
2. Cherche le code-barres exact sur le web — bases de codes-barres, fiches de vente, sites de collectionneurs — pour savoir à quel jeu et à quelle édition il correspond. Sans code-barres, cherche d'après le titre, la plateforme et ce que montre la photo. Cherche aussi le serial s'il est connu.
3. Recoupe la photo, le code-barres et le serial. Une discordance se signale dans doubts ; ne la résous pas en silence.
4. Termine toujours par un appel à l'outil proposer_fiche, une seule fois. Si le jeu reste inconnu, appelle-le avec identified à false et explique pourquoi dans summary.

Dans sources, ne cite que des pages renvoyées par tes recherches. shows_ean n'est vrai que si la page montre ce code-barres exact ; shows_title que si elle le rattache au titre proposé.

Conventions de la collection :
- platform : de préférence un nom déjà employé dans la collection (liste fournie), sinon le nom court usuel (PS2, Switch, N64, Mega Drive, Xbox 360…) ;
- region : PAL, NTSC-U ou NTSC-J, ou vide si elle ne peut pas être établie ;
- serial : tel qu'il est imprimé ;
- ean : le code-barres de cet exemplaire seulement, fourni ou lu sur la photo ; jamais un code trouvé en ligne, qui peut appartenir à une autre édition ;
- title : le titre de l'édition concernée, tel qu'il figure sur la boîte.
Rédige summary et doubts en français, brièvement.`;

const CHAMPS_JEU = {
  title: { type: 'string' },
  platform: { type: 'string' },
  region: { type: 'string', enum: ['PAL', 'NTSC-U', 'NTSC-J', ''] },
  serial: { type: 'string' },
  ean: { type: 'string', description: 'Chiffres seuls, ou vide' },
};

const OUTIL = {
  name: 'proposer_fiche',
  description: 'Rend la fiche proposée pour le jeu, avec ce qui a été lu sur la photo et les sources trouvées. À appeler une seule fois, pour conclure.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['identified', 'title', 'platform', 'region', 'serial', 'ean', 'seen_on_photo', 'sources', 'doubts', 'summary'],
    properties: {
      identified: { type: 'boolean' },
      ...CHAMPS_JEU,
      seen_on_photo: {
        type: 'object',
        additionalProperties: false,
        required: Object.keys(CHAMPS_JEU),
        properties: CHAMPS_JEU,
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['url', 'title', 'shows_ean', 'shows_title'],
          properties: {
            url: { type: 'string' },
            title: { type: 'string' },
            shows_ean: { type: 'boolean' },
            shows_title: { type: 'boolean' },
          },
        },
      },
      doubts: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
  },
};

const plateformesConnues = db.prepare(
  `SELECT platform FROM games WHERE platform <> ''
    GROUP BY platform ORDER BY COUNT(*) DESC LIMIT 40`,
);

function consigneUtilisateur({ ean, eanSource, serial, avecPhoto }) {
  const plateformes = plateformesConnues.all().map((row) => row.platform);
  return [
    avecPhoto ? 'Photo du boîtier ci-dessus.' : 'Pas de photo.',
    ean
      ? `Code-barres : ${ean} (${eanSource === 'photo' ? 'lu sur la photo par l’application' : 'tapé à la main'}).`
      : 'Code-barres : non fourni.',
    serial ? `Serial : ${serial} (fourni par l’utilisateur).` : 'Serial : non fourni.',
    `Plateformes déjà dans la collection : ${plateformes.length ? plateformes.join(', ') : 'aucune'}.`,
  ].join('\n');
}

/* --------------------------------------------------------------------------
 * Photo
 * ----------------------------------------------------------------------- */

async function preparerPhoto(buffer) {
  const type = typeImageReel(buffer);
  if (!type) throw new ErreurIdentification('Le fichier envoye n est pas une image reconnue', 400);
  if (sharp) {
    try {
      const jpeg = await sharp(buffer, { limitInputPixels: 50_000_000, failOn: 'error' })
        .autoOrient()
        .resize({ width: COTE_MAX, height: COTE_MAX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      return { media_type: 'image/jpeg', data: jpeg.toString('base64') };
    } catch (err) {
      throw new ErreurIdentification(`Photo illisible (${err.message.split('\n')[0]})`, 400);
    }
  }
  if (!TYPES_ACCEPTES.has(type)) {
    throw new ErreurIdentification('Format de photo non pris en charge sans reduction : envoyez un JPEG', 415);
  }
  return { media_type: type, data: buffer.toString('base64') };
}

/* --------------------------------------------------------------------------
 * Appel a Claude
 * ----------------------------------------------------------------------- */

let client = null;
const claude = () => {
  client ??= new Anthropic({ apiKey: config.anthropicApiKey, timeout: DELAI_MS, maxRetries: 1 });
  return client;
};

/** Forme comparable d'une adresse : sans fragment ni barre finale. */
function adresse(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** Adresses reellement renvoyees par la recherche, et titres de leurs pages. */
function pagesTrouvees(content, pages) {
  for (const block of content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const resultat of block.content) {
        if (resultat?.url) pages.set(adresse(resultat.url), resultat.title || '');
      }
    }
  }
}

function traduireErreur(err) {
  if (err instanceof ErreurIdentification) return err;
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return new ErreurIdentification('Cle Anthropic refusee : verifiez ANTHROPIC_API_KEY dans le fichier .env', 503);
  }
  if (err instanceof RateLimitError) {
    return new ErreurIdentification('Quota Anthropic atteint : reessayez dans quelques minutes', 503);
  }
  // Le delai d'abord : c'est un cas particulier d'echec de connexion.
  if (err instanceof APIConnectionTimeoutError) {
    return new ErreurIdentification('Claude n a pas repondu a temps : reessayez', 504);
  }
  if (err instanceof APIConnectionError) {
    return new ErreurIdentification('Service Anthropic injoignable depuis le serveur', 502);
  }
  if (err instanceof BadRequestError) {
    console.error('[erreur] Requete refusee par Anthropic :', err.message);
    return new ErreurIdentification('Requete refusee par Anthropic (details dans le journal du serveur)', 502);
  }
  if (err instanceof APIError) {
    return new ErreurIdentification(`Le service Anthropic a repondu ${err.status ?? 'une erreur'}`, 502);
  }
  return err;
}

async function interroger({ photo, ean, eanSource, serial }) {
  const content = [];
  if (photo) content.push({ type: 'image', source: { type: 'base64', ...photo } });
  content.push({ type: 'text', text: consigneUtilisateur({ ean, eanSource, serial, avecPhoto: Boolean(photo) }) });
  const messages = [{ role: 'user', content }];

  const pages = new Map();
  const usage = { lus: 0, ecrits: 0, recherches: 0 };
  let relance = false;

  for (let tour = 0; tour < TOURS_MAX; tour += 1) {
    let reponse;
    try {
      reponse = await claude().beta.messages.create({
        model: MODELE,
        max_tokens: 16000,
        // Si les garde-fous du modele declinent la demande, l'API la rejoue
        // d'elle-meme sur le modele de repli qu'Anthropic recommande.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: EFFORT },
        system: SYSTEME,
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: RECHERCHES_MAX,
            // La collection est europeenne : les fiches PAL d'abord.
            user_location: { type: 'approximate', country: 'FR' },
          },
          OUTIL,
        ],
        messages,
      });
    } catch (err) {
      throw traduireErreur(err);
    }

    usage.lus += reponse.usage?.input_tokens || 0;
    usage.ecrits += reponse.usage?.output_tokens || 0;
    usage.recherches += reponse.usage?.server_tool_use?.web_search_requests || 0;
    pagesTrouvees(reponse.content, pages);

    if (reponse.stop_reason === 'refusal') {
      throw new ErreurIdentification('Claude a refuse d examiner cette demande', 502);
    }
    const appel = reponse.content.find((b) => b.type === 'tool_use' && b.name === OUTIL.name);
    if (appel) return { proposition: appel.input, pages, usage, modele: reponse.model };
    if (reponse.stop_reason === 'max_tokens') {
      throw new ErreurIdentification('Reponse de Claude interrompue avant sa conclusion', 502);
    }

    // L'historique ne fait que s'allonger : les blocs de reflexion renvoyes
    // restent valides d'un tour a l'autre.
    messages.push({ role: 'assistant', content: reponse.content });
    if (reponse.stop_reason === 'pause_turn') continue;
    if (relance) break;
    relance = true;
    messages.push({
      role: 'user',
      content: 'Conclus maintenant en appelant proposer_fiche, même si le jeu reste inconnu.',
    });
  }
  throw new ErreurIdentification('Claude n a pas conclu son identification : reessayez', 502);
}

/* --------------------------------------------------------------------------
 * Verification
 * ----------------------------------------------------------------------- */

const texte = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const chiffres = (value) => String(value ?? '').replace(/\D/g, '');
const serialNu = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Clef de controle d'un GTIN (EAN-8, UPC-A, EAN-13, ITF-14). */
function clefJuste(ean) {
  if (![8, 12, 13, 14].includes(ean.length)) return false;
  let somme = 0;
  for (let i = 0; i < ean.length - 1; i += 1) {
    somme += Number(ean[i]) * ((ean.length - 1 - i) % 2 === 1 ? 3 : 1);
  }
  return (10 - (somme % 10)) % 10 === Number(ean.at(-1));
}

/** Meme code-barres, a l'ecriture UPC-A / EAN-13 pres. */
const memeEan = (a, b) => eanVariants(a).includes(b) || eanVariants(b).includes(a);

function lireJeu(source = {}) {
  return {
    title: texte(source.title),
    platform: texte(source.platform, 120),
    region: ['PAL', 'NTSC-U', 'NTSC-J'].includes(source.region) ? source.region : '',
    serial: texte(source.serial, 40),
    ean: chiffres(source.ean).slice(0, 14),
  };
}

/**
 * Confronte la proposition a ce qui a ete fourni et a ce que la recherche a
 * reellement renvoye. Chaque verification vaut `ok` : true (concorde), false
 * (contredit) ou null (rien a comparer).
 */
function verifier({ proposition, pages, ean, serial }) {
  const identified = Boolean(proposition?.identified);
  const game = lireJeu(proposition);
  const photo = lireJeu(proposition?.seen_on_photo);
  const checks = [];

  // Le code-barres de cet exemplaire : fourni, ou lu par Claude sur la photo.
  // Un code trouve seulement en ligne peut etre celui d'une autre edition —
  // autre region, reedition : il ne confirme rien et n'entre pas dans la
  // fiche, ou le scan repondrait ensuite a cote.
  const eanExemplaire = ean || photo.ean;
  if (eanExemplaire) {
    checks.push({ key: 'ean_key', ok: clefJuste(eanExemplaire), ean: eanExemplaire });
  } else {
    checks.push({ key: 'no_ean', ok: null });
  }
  if (ean && photo.ean) checks.push({ key: 'photo_ean', ok: memeEan(ean, photo.ean), given: ean, photo: photo.ean });
  if (eanExemplaire && game.ean) {
    checks.push({ key: 'proposed_ean', ok: memeEan(eanExemplaire, game.ean), given: eanExemplaire, proposed: game.ean });
  }
  if (serial && game.serial) {
    checks.push({ key: 'serial', ok: serialNu(serial) === serialNu(game.serial), given: serial, proposed: game.serial });
  }
  if (photo.serial && game.serial) {
    checks.push({ key: 'photo_serial', ok: serialNu(photo.serial) === serialNu(game.serial), photo: photo.serial, proposed: game.serial });
  }
  if (photo.region && game.region) {
    checks.push({ key: 'region', ok: photo.region === game.region, photo: photo.region, proposed: game.region });
  }

  // Seules comptent les pages que la recherche a renvoyees.
  const citees = Array.isArray(proposition?.sources) ? proposition.sources : [];
  const verifiees = citees.filter((s) => pages.has(adresse(s?.url)));
  // Sans code-barres de l'exemplaire, une source ne relie rien : elle peut
  // seulement confirmer le titre.
  const reliees = eanExemplaire ? verifiees.filter((s) => s.shows_ean && s.shows_title) : [];
  const titrees = verifiees.filter((s) => s.shows_title);
  checks.push({ key: 'title_on_photo', ok: photo.title ? true : null, title: photo.title });
  checks.push({
    key: 'sources',
    ok: (eanExemplaire ? reliees.length : titrees.length) ? true : null,
    withEan: Boolean(eanExemplaire),
    count: eanExemplaire ? reliees.length : titrees.length,
    discarded: citees.length - verifiees.length,
  });

  // Une absence d'indice n'est pas une contradiction : seules les
  // verifications de concordance peuvent faire tomber le verdict.
  const contredit = checks.some((c) => c.ok === false);
  let verdict;
  if (!identified) verdict = 'not_found';
  else if (contredit) verdict = 'uncertain';
  else if (reliees.length && eanExemplaire) verdict = 'confirmed';
  else if (photo.title || titrees.length) verdict = 'likely';
  else verdict = 'uncertain';

  game.ean = eanExemplaire;

  return {
    verdict,
    game: identified ? game : { ...lireJeu({}), ean: eanExemplaire },
    photo,
    checks,
    summary: texte(proposition?.summary, 600),
    doubts: (Array.isArray(proposition?.doubts) ? proposition.doubts : []).map((d) => texte(d, 300)).filter(Boolean).slice(0, 6),
    sources: reliees.concat(verifiees.filter((s) => !reliees.includes(s))).slice(0, 5).map((s) => ({
      url: adresse(s.url),
      title: texte(s.title) || pages.get(adresse(s.url)) || '',
      links: reliees.includes(s),
    })),
  };
}

/* --------------------------------------------------------------------------
 * Point d'entree
 * ----------------------------------------------------------------------- */

/**
 * Identifie un jeu. `photo` : contenu de l'image ou null ; `ean` : chiffres
 * deja verifies (8 a 14) ou vide ; `serial` : texte libre ou vide.
 */
export async function identifier({ photo = null, ean = '', eanSource = 'saisie', serial = '' }) {
  const image = photo ? await preparerPhoto(photo) : null;
  const { proposition, pages, usage, modele } = await interroger({ photo: image, ean, eanSource, serial });
  const resultat = verifier({ proposition, pages, ean, serial });
  console.log(
    `  Identification (${modele}) : ${resultat.verdict}, ${usage.lus} jetons lus, ${usage.ecrits} ecrits, `
    + `${usage.recherches} recherche(s)`,
  );
  return { ...resultat, model: modele };
}
