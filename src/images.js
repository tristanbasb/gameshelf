/*
 * Reconnaissance du type reel d'une image.
 *
 * Le type annonce par le navigateur lors d'un televersement n'est qu'une
 * declaration : rien n'empeche d'envoyer n'importe quel fichier en l'appelant
 * « image/png ». Les premiers octets, eux, ne se negocient pas. On s'y fie
 * donc pour decider si le fichier est bien une image, et pour lui donner la
 * bonne extension — c'est elle qui determinera le type servi ensuite.
 */

/** Extension de fichier pour chaque type d'image accepte. */
export const EXTENSIONS_IMAGE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

/** Nombre d'octets necessaires pour trancher. */
export const ENTETE_OCTETS = 32;

const commence = (buffer, octets, decalage = 0) =>
  octets.every((octet, index) => buffer[decalage + index] === octet);

const texte = (buffer, debut, fin) => buffer.slice(debut, fin).toString('latin1');

/** Marques de boitier ISO-BMFF correspondant a une image AVIF. */
const MARQUES_AVIF = ['avif', 'avis', 'mif1', 'msf1'];

/**
 * Type reel d'une image, lu dans son entete, ou null si le contenu n'est
 * aucune des images acceptees.
 */
export function typeImageReel(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // PNG : signature de huit octets.
  if (commence(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // JPEG : marqueur de debut d'image.
  if (commence(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // GIF : « GIF87a » ou « GIF89a ».
  if (texte(buffer, 0, 4) === 'GIF8') return 'image/gif';

  // WebP : conteneur RIFF dont le format est « WEBP ».
  if (texte(buffer, 0, 4) === 'RIFF' && texte(buffer, 8, 12) === 'WEBP') return 'image/webp';

  // AVIF : boitier ISO-BMFF, la marque suit le mot « ftyp ».
  if (texte(buffer, 4, 8) === 'ftyp' && MARQUES_AVIF.includes(texte(buffer, 8, 12))) {
    return 'image/avif';
  }

  return null;
}

export default typeImageReel;
