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

/** Detecteur bati sur l'API du navigateur. */
async function nativeDetector() {
  const supported = await window.BarcodeDetector.getSupportedFormats();
  const formats = FORMATS.filter((f) => supported.includes(f));
  const detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);
  return {
    engine: 'natif',
    detect: (video) => detector.detect(video),
  };
}

/** Detecteur bati sur ZXing : une image est extraite de la video par frame. */
async function zxingDetector() {
  const ZXing = await loadZxing();

  const reader = new ZXing.MultiFormatReader();
  const hints = new Map();
  hints.set(
    ZXing.DecodeHintType.POSSIBLE_FORMATS,
    ZXING_FORMATS.map((name) => ZXing.BarcodeFormat[name]),
  );
  // Les codes sont souvent lus de biais ou mal eclairs : on laisse le
  // decodeur insister, quitte a etre un peu plus lent par image.
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  return {
    engine: 'zxing',
    detect(video) {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return [];

      // On limite la largeur d'analyse : au-dela, le decodage coute cher
      // sans rien apporter a la lecture d'un code-barres.
      const scale = Math.min(1, 900 / width);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      try {
        const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
        const result = reader.decode(bitmap);
        return [{ rawValue: result.getText() }];
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
