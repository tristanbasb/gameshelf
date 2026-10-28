/*
 * Plateformes : de quoi dessiner un boitier sans l'avoir sous les yeux.
 *
 * La base ne stocke qu'un nom saisi a la main — « PS2 », « PlayStation 2 »,
 * « Switch ». Ce module le reconnait et lui associe ce qui distingue ses
 * boitiers sur une etagere reelle :
 *
 *   - `epaisseur` et `hauteur` en millimetres : la largeur et la hauteur de la
 *     tranche. Un boitier de PS2 est un boitier DVD de 14 mm, un jeu Switch
 *     tient dans 11 mm, une boite de N64 en carton en prend 35 ;
 *   - `format` : largeur / hauteur de la face avant, pour afficher chaque
 *     jaquette a ses vraies proportions ;
 *   - les couleurs de la tranche : `fond`, le bandeau d'en-tete (`bandeau`,
 *     `encreBandeau`) et l'encre du titre ;
 *   - `trait` : la couleur qui represente la plateforme dans la frise de la
 *     collection et dans le bilan.
 *
 * Ce qu'aucun motif ne reconnait garde un boitier DVD et une teinte tiree du
 * nom : stable, d'une session a l'autre.
 */

const DVD = { epaisseur: 14, hauteur: 190, format: 135 / 190 };
const BLURAY = { epaisseur: 12, hauteur: 171, format: 135 / 171 };

const CONNUES = [
  {
    cle: 'ps1', famille: 'PlayStation', court: 'PS1',
    motifs: [/^(ps ?1|psx|ps ?one|playstation( ?1)?)$/i],
    epaisseur: 10.4, hauteur: 125, format: 142 / 125,
    fond: '#17171c', bandeau: '#2a2a33', encreBandeau: '#d6d6de', encre: '#ececf2', trait: '#8e8e9c',
  },
  {
    cle: 'ps2', famille: 'PlayStation', court: 'PS2',
    motifs: [/^(ps ?2|playstation ?2)$/i],
    ...DVD,
    fond: '#0c0d12', bandeau: '#1f4fd8', encreBandeau: '#ffffff', encre: '#eef1ff', trait: '#3466ff',
  },
  {
    cle: 'ps3', famille: 'PlayStation', court: 'PS3',
    motifs: [/^(ps ?3|playstation ?3)$/i],
    ...BLURAY,
    fond: '#141518', bandeau: '#e8ebf0', encreBandeau: '#111216', encre: '#f2f3f6', trait: '#cfd5df',
  },
  {
    cle: 'ps4', famille: 'PlayStation', court: 'PS4',
    motifs: [/^(ps ?4|playstation ?4)$/i],
    ...BLURAY,
    fond: '#0f1524', bandeau: '#0a46b8', encreBandeau: '#ffffff', encre: '#eef2fb', trait: '#1257d6',
  },
  {
    cle: 'ps5', famille: 'PlayStation', court: 'PS5',
    motifs: [/^(ps ?5|playstation ?5)$/i],
    ...BLURAY,
    fond: '#f1f2f5', bandeau: '#ffffff', encreBandeau: '#111216', encre: '#15161a', trait: '#f4f5f8',
  },
  {
    cle: 'psp', famille: 'PlayStation', court: 'PSP',
    motifs: [/^(psp|playstation portable)$/i],
    epaisseur: 14, hauteur: 178, format: 105 / 178,
    fond: '#111114', bandeau: '#2c2c33', encreBandeau: '#e6e6ec', encre: '#e6e6ec', trait: '#6c6c7a',
  },
  {
    cle: 'vita', famille: 'PlayStation', court: 'Vita',
    motifs: [/vita/i],
    epaisseur: 11, hauteur: 135, format: 105 / 135,
    fond: '#13151c', bandeau: '#2d6ff0', encreBandeau: '#ffffff', encre: '#eef0f6', trait: '#4b86ff',
  },
  {
    cle: 'switch2', famille: 'Nintendo', court: 'Switch 2',
    motifs: [/switch ?2/i],
    epaisseur: 11, hauteur: 170, format: 105 / 170,
    fond: '#b10017', bandeau: '#e3001b', encreBandeau: '#ffffff', encre: '#ffffff', trait: '#ff4d5a',
  },
  {
    cle: 'switch', famille: 'Nintendo', court: 'Switch',
    motifs: [/switch/i],
    epaisseur: 11, hauteur: 170, format: 105 / 170,
    fond: '#d40019', bandeau: '#e60012', encreBandeau: '#ffffff', encre: '#ffffff', trait: '#e8101f',
  },
  {
    cle: '3ds', famille: 'Nintendo', court: '3DS',
    motifs: [/3 ?ds/i],
    epaisseur: 12, hauteur: 137, format: 125 / 137,
    fond: '#f3f3f5', bandeau: '#d82b2b', encreBandeau: '#ffffff', encre: '#1d1d22', trait: '#ff7a7a',
  },
  {
    cle: 'ds', famille: 'Nintendo', court: 'DS',
    motifs: [/^(n?ds|nintendo ds|dsi)$/i],
    epaisseur: 14, hauteur: 137, format: 125 / 137,
    fond: '#e6e7ea', bandeau: '#c3c5cc', encreBandeau: '#26262b', encre: '#1d1d22', trait: '#b4b8c3',
  },
  {
    cle: 'n64', famille: 'Nintendo', court: 'N64',
    motifs: [/^(n ?64|nintendo ?64)$/i],
    epaisseur: 35, hauteur: 127, format: 177 / 127,
    fond: '#18181b', bandeau: '#26262b', encreBandeau: '#f2c200', encre: '#f5f5f5', trait: '#f2c200',
  },
  {
    cle: 'wii', famille: 'Nintendo', court: 'Wii',
    motifs: [/^wii( u)?$/i],
    ...DVD,
    fond: '#f4f5f7', bandeau: '#d9dbe0', encreBandeau: '#2a2a2f', encre: '#1d1d22', trait: '#e9ebf0',
  },
  {
    cle: 'gc', famille: 'Nintendo', court: 'GC',
    motifs: [/game ?cube|^ngc$/i],
    epaisseur: 14, hauteur: 190, format: 135 / 190,
    fond: '#1a1a1f', bandeau: '#5b4fc4', encreBandeau: '#ffffff', encre: '#eeeef4', trait: '#7a6cf0',
  },
  {
    cle: 'x360', famille: 'Xbox', court: '360',
    motifs: [/x ?box ?360/i],
    ...DVD,
    fond: '#f1f3ef', bandeau: '#107c10', encreBandeau: '#ffffff', encre: '#1b1b1b', trait: '#3fb33f',
  },
  {
    cle: 'xbox', famille: 'Xbox', court: 'Xbox',
    motifs: [/x ?box/i],
    ...DVD,
    fond: '#151816', bandeau: '#107c10', encreBandeau: '#ffffff', encre: '#eef2ee', trait: '#2f9e2f',
  },
];

/*
 * Familles reconnues pour les plateformes sans fiche propre, dans l'ordre ou
 * elles se rangent. « PC Engine » doit etre reconnu avant que « PC » ne
 * l'attrape.
 */
const FAMILLES = [
  { nom: 'PlayStation', motifs: [/playstation/i, /\bps ?[1-5]\b/i, /\bpsx\b/i, /\bpsp\b/i, /\bvita\b/i] },
  { nom: 'Nintendo', motifs: [/nintendo/i, /\bs?nes\b/i, /famicom/i, /\bn ?64\b/i, /game ?cube/i, /\bwii\b/i, /switch/i, /game ?boy/i, /\bgb[ac]?\b/i, /\b3?ds\b/i] },
  { nom: 'Xbox', motifs: [/xbox/i] },
  { nom: 'Sega', motifs: [/sega/i, /mega ?drive/i, /genesis/i, /master ?system/i, /dreamcast/i, /saturn/i, /game ?gear/i] },
  { nom: 'NEC', motifs: [/pc ?engine/i, /turbografx/i] },
  { nom: 'Atari', motifs: [/atari/i, /\blynx\b/i, /\bjaguar\b/i] },
  { nom: 'SNK', motifs: [/neo ?geo/i, /\bsnk\b/i] },
  { nom: 'Ordinateurs', motifs: [/\bpc\b/i, /windows/i, /steam/i, /\bmac\b/i, /amiga/i, /amstrad/i, /commodore/i, /msx/i] },
];

export const ORDRE_FAMILLES = [...FAMILLES.map((f) => f.nom), 'Autres'];

function teinte(texte) {
  let somme = 0;
  for (let i = 0; i < texte.length; i += 1) somme = (somme * 31 + texte.charCodeAt(i)) % 360;
  return somme;
}

const cache = new Map();

/** Fiche d'une plateforme, a partir du nom libre saisi dans la collection. */
export function plateforme(nom) {
  const brut = String(nom ?? '').trim();
  if (cache.has(brut)) return cache.get(brut);

  const connue = CONNUES.find((p) => p.motifs.some((m) => m.test(brut)));
  let fiche;
  if (connue) {
    fiche = { ...connue, nom: brut };
  } else {
    const famille = FAMILLES.find((f) => f.motifs.some((m) => m.test(brut)))?.nom || 'Autres';
    const h = teinte(brut || '?');
    fiche = {
      cle: `autre-${h}`, famille, court: brut || '—', nom: brut, ...DVD,
      fond: `hsl(${h} 30% 16%)`, bandeau: `hsl(${h} 55% 42%)`, encreBandeau: '#ffffff',
      encre: '#f2f2f6', trait: `hsl(${h} 70% 58%)`,
    };
  }
  cache.set(brut, fiche);
  return fiche;
}

/** Rang de rangement d'une plateforme : famille, puis nom. */
export function rangFamille(nom) {
  return ORDRE_FAMILLES.indexOf(plateforme(nom).famille);
}

/*
 * Un seul comparateur pour toute l'application : `localeCompare` avec une
 * langue et des options en refabrique un a chaque appel, cinquante fois plus
 * lent. Trier l'etagere de 1 500 jeux prenait 20 ms, 1 ms desormais.
 */
const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/** Compare deux plateformes dans l'ordre d'une etagere. */
export function comparerPlateformes(a, b) {
  return rangFamille(a) - rangFamille(b) || collator.compare(String(a), String(b));
}
