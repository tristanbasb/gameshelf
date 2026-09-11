/*
 * Lecture de codes-barres, quel que soit le navigateur.
 *
 * Chrome et Edge fournissent l'API BarcodeDetector. Safari, sur iPhone comme
 * sur Mac, ne l'implemente pas : sans repli, le scan y serait impossible et
 * il faudrait saisir treize chiffres a la main devant le rayon.
 *
 * Ce module expose un detecteur au comportement identique dans les deux cas —
 * `detect(image, largeur, hauteur)` renvoie un tableau de `{ rawValue }` — en
 * s'appuyant sur le decodeur natif s'il existe, sinon sur ZXing embarque avec
 * l'application. Ce dernier pese 350 Ko : il n'est telecharge qu'au moment ou
 * il sert.
 *
 * `image` est une ImageBitmap, deja decoupee a la zone du viseur : analyser
 * l'image entiere revenait a lire le code-barres sur une fraction des pixels
 * disponibles, et obligeait a coller le telephone sur la boite. Le detecteur
 * la libere lui-meme apres usage ; l'appelant n'a pas a s'en soucier.
 */

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];

/** Noms ZXing des memes formats, resolus une fois la bibliotheque chargee. */
const ZXING_FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'ITF'];

/** Au-dela, le worker cesse d'etre attendu et l'on decode sur place. */
const DELAI_DEMARRAGE_WORKER = 8000;

let zxingLoader = null;

/** Charge le decodeur embarque une seule fois, a la demande. */
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (zxingLoader) return zxingLoader;

  zxingLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Chemin relatif : le prefixe de version du serveur est ainsi conserve.
    script.src = new URL('./vendor/zxing.min.js', import.meta.url).href;
    script.addEventListener('load', () => {
      if (window.ZXing) resolve(window.ZXing);
      else reject(new Error('décodeur illisible'));
    });
    script.addEventListener('error', () => reject(new Error('décodeur introuvable')));
    document.head.appendChild(script);
  });
  return zxingLoader;
}

/** Detecteur bati sur l'API du navigateur. */
async function nativeDetector() {
  const supported = await window.BarcodeDetector.getSupportedFormats();
  const formats = FORMATS.filter((f) => supported.includes(f));
  const detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);
  return {
    engine: 'natif',
    // La lecture native se fait hors du fil principal, dans le navigateur
    // lui-meme : inutile de reduire l'image, elle profite de tous les pixels.
    async detect(image) {
      try {
        return await detector.detect(image);
      } finally {
        image.close?.();
      }
    },
    close() {},
  };
}

/*
 * Demarre le worker de decodage. Il renvoie null — sans que ce soit une
 * erreur — quand le navigateur ne sait pas dessiner hors du fil principal :
 * on decode alors sur place, comme avant.
 */
function startWorker() {
  const outille = typeof Worker !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined'
    && typeof createImageBitmap === 'function';
  if (!outille) return Promise.resolve(null);

  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL('./scan-worker.js', import.meta.url));
    } catch {
      resolve(null);
      return;
    }

    let regle = false;
    const abandonner = () => {
      if (regle) return;
      regle = true;
      clearTimeout(minuteur);
      worker.terminate();
      resolve(null);
    };
    const minuteur = setTimeout(abandonner, DELAI_DEMARRAGE_WORKER);
    worker.addEventListener('error', abandonner, { once: true });

    worker.addEventListener('message', (event) => {
      if (!event.data?.ready || regle) return;
      regle = true;
      clearTimeout(minuteur);
      if (event.data.ok) resolve(worker);
      else {
        worker.terminate();
        resolve(null);
      }
    });
  });
}

/** Enveloppe le worker dans la meme interface que les autres detecteurs. */
function workerDetector(worker) {
  const attentes = new Map();
  let suivant = 0;

  worker.addEventListener('message', (event) => {
    const { id, code } = event.data || {};
    const resoudre = attentes.get(id);
    if (!resoudre) return;
    attentes.delete(id);
    resoudre(code ? [{ rawValue: code }] : []);
  });
  // Un worker qui meurt en cours de route ne doit pas laisser le scan
  // suspendu a une promesse qui ne se resoudra jamais.
  worker.addEventListener('error', () => {
    attentes.forEach((resoudre) => resoudre([]));
    attentes.clear();
  });

  return {
    engine: 'zxing-worker',
    detect(image, largeur, hauteur) {
      const id = (suivant += 1);
      return new Promise((resolve) => {
        attentes.set(id, resolve);
        worker.postMessage({ id, image, largeur, hauteur }, [image]);
      });
    },
    close() {
      attentes.forEach((resoudre) => resoudre([]));
      attentes.clear();
      worker.terminate();
    },
  };
}

/** Decodeur ZXing sur le fil principal, quand le worker n'est pas possible. */
async function zxingDetector() {
  const ZXing = await loadZxing();

  const reader = new ZXing.MultiFormatReader();
  const hints = new Map();
  hints.set(
    ZXing.DecodeHintType.POSSIBLE_FORMATS,
    ZXING_FORMATS.map((name) => ZXing.BarcodeFormat[name]),
  );
  // Les codes sont souvent lus de biais ou mal eclaires : on laisse le
  // decodeur insister, quitte a etre un peu plus lent par image.
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);

  const canvas = document.createElement('canvas');
  const contexte = canvas.getContext('2d', { willReadFrequently: true });

  return {
    engine: 'zxing',
    detect(image, largeur, hauteur) {
      try {
        if (!largeur || !hauteur) return [];
        canvas.width = largeur;
        canvas.height = hauteur;
        contexte.drawImage(image, 0, 0, largeur, hauteur);
        const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
        return [{ rawValue: reader.decode(bitmap).getText() }];
      } catch {
        // Aucun code sur cette image : cas courant, pas une erreur.
        return [];
      } finally {
        reader.reset();
        image.close?.();
      }
    },
    close() {},
  };
}

/** Un decodeur est-il disponible, d'une facon ou d'une autre ? */
export const barcodeReadingSupported = () => true;

/**
 * Renvoie un detecteur pret a l'emploi. Prefere l'API du navigateur, plus
 * rapide car materielle, puis le worker, et ne decode sur le fil principal
 * qu'en dernier recours.
 */
export async function createBarcodeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      return await nativeDetector();
    } catch {
      // API presente mais inutilisable : on tente quand meme le repli.
    }
  }
  const worker = await startWorker();
  if (worker) return workerDetector(worker);
  return zxingDetector();
}
