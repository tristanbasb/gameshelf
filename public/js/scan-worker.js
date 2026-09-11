/*
 * Decodage des codes-barres, hors du fil principal.
 *
 * Le decodage lui-meme ne coute presque rien : moins d'une milliseconde par
 * image une fois les pixels disponibles. Ce qui coute, c'est justement de
 * les obtenir — sortir de la carte graphique les douze millions de pixels
 * d'une photo demande plusieurs centaines de millisecondes. Fait sur le fil
 * principal, ce transfert figerait l'interface le temps de la lecture.
 *
 * Ce worker recoit la photo, la reduit a la definition demandee, en extrait
 * les niveaux de gris et la confie a ZXing. Le fil principal n'a plus qu'a
 * fabriquer l'image (0,1 ms) et a afficher le resultat.
 */

const FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'ITF'];

let lecteur = null;
let canvas = null;
let contexte = null;
let gris = null;

/*
 * Mise en route. Tout peut manquer ici — OffscreenCanvas n'existe pas sur
 * les navigateurs anciens — auquel cas on le signale et l'appelant repasse
 * sur le fil principal plutot que de perdre le scan.
 */
let pret = false;
try {
  // Chemin relatif : resolu par rapport a ce fichier, donc a l'interieur du
  // dossier versionne servi par l'application.
  importScripts('./vendor/zxing.min.js');

  canvas = new OffscreenCanvas(16, 16);
  contexte = canvas.getContext('2d', { willReadFrequently: true });

  lecteur = new ZXing.MultiFormatReader();
  const consignes = new Map();
  consignes.set(
    ZXing.DecodeHintType.POSSIBLE_FORMATS,
    FORMATS.map((nom) => ZXing.BarcodeFormat[nom]),
  );
  // Les codes sont souvent lus de biais ou mal eclaires : on laisse le
  // decodeur insister, ce qu'il peut se permettre ici.
  consignes.set(ZXing.DecodeHintType.TRY_HARDER, true);
  lecteur.setHints(consignes);

  pret = Boolean(contexte && lecteur);
} catch {
  pret = false;
}

self.postMessage({ ready: true, ok: pret });

/** Lit le code present sur une image, ou renvoie null si elle n'en porte pas. */
function lire(image, largeur, hauteur) {
  if (canvas.width !== largeur || canvas.height !== hauteur) {
    canvas.width = largeur;
    canvas.height = hauteur;
  }
  contexte.drawImage(image, 0, 0, largeur, hauteur);
  const pixels = contexte.getImageData(0, 0, largeur, hauteur).data;

  // ZXing ne travaille que sur la luminance : la convertir soi-meme evite de
  // lui repasser quatre fois plus d'octets que necessaire. Coefficients
  // entiers (306/601/117 sur 1024) pour rester en arithmetique rapide.
  if (!gris || gris.length !== largeur * hauteur) {
    gris = new Uint8ClampedArray(largeur * hauteur);
  }
  for (let p = 0, g = 0; g < gris.length; p += 4, g += 1) {
    gris[g] = (pixels[p] * 306 + pixels[p + 1] * 601 + pixels[p + 2] * 117) >> 10;
  }

  try {
    const source = new ZXing.RGBLuminanceSource(gris, largeur, hauteur);
    const binaire = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
    return lecteur.decode(binaire).getText();
  } catch {
    // Aucun code sur cette image : cas courant pendant qu'on vise.
    return null;
  } finally {
    lecteur.reset();
  }
}

self.addEventListener('message', (event) => {
  const { id, image, largeur, hauteur } = event.data || {};
  let code = null;
  try {
    if (pret && image && largeur > 0 && hauteur > 0) code = lire(image, largeur, hauteur);
  } catch {
    code = null;
  } finally {
    image?.close?.();
  }
  self.postMessage({ id, code });
});
