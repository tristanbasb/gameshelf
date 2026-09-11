/*
 * Lecture de codes-barres, quel que soit le navigateur.
 *
 * Chrome et Edge fournissent l'API BarcodeDetector. Safari, sur iPhone comme
 * sur Mac, ne l'implemente pas : sans repli, le scan y serait impossible et
 * il faudrait saisir treize chiffres a la main devant le rayon.
 *
 * Ce module expose un detecteur au comportement identique dans les deux cas —
 * `detect(video)` renvoie un tableau de `{ rawValue }` — en s'appuyant sur le
 * decodeur natif s'il existe, sinon sur ZXing embarque avec l'application.
 * Ce dernier pese 350 Ko : il n'est telecharge qu'au moment ou il sert.
 */

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];

/** Noms ZXing des memes formats, resolus une fois la bibliotheque chargee. */
const ZXING_FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'ITF'];

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

/*
 * Les deux detecteurs recoivent un canvas, pas l'element video : l'appelant y
 * a deja decoupe la zone du viseur, a la resolution du capteur. Analyser
 * l'image entiere revenait a lire le code-barres sur une fraction des pixels
 * disponibles, et obligeait a coller le telephone sur la boite.
 */

/** Detecteur bati sur l'API du navigateur. */
async function nativeDetector() {
  const supported = await window.BarcodeDetector.getSupportedFormats();
  const formats = FORMATS.filter((f) => supported.includes(f));
  const detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);
  return {
    engine: 'natif',
    detect: (canvas) => detector.detect(canvas),
  };
}

/** Detecteur bati sur ZXing, pour les navigateurs sans API de lecture. */
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

  return {
    engine: 'zxing',
    detect(canvas) {
      if (!canvas.width || !canvas.height) return [];
      try {
        const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
        return [{ rawValue: reader.decode(bitmap).getText() }];
      } catch {
        // Aucun code sur cette image : cas courant, pas une erreur.
        return [];
      } finally {
        reader.reset();
      }
    },
  };
}

/** Un decodeur est-il disponible, d'une facon ou d'une autre ? */
export const barcodeReadingSupported = () => true;

/**
 * Renvoie un detecteur pret a l'emploi. Prefere l'API du navigateur, plus
 * rapide car materielle, et retombe sur ZXing partout ailleurs.
 */
export async function createBarcodeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      return await nativeDetector();
    } catch {
      // API presente mais inutilisable : on tente quand meme le repli.
    }
  }
  return zxingDetector();
}
