/*
 * Code-barres dessine a partir de l'EAN enregistre, tel qu'il est imprime au
 * dos du boitier.
 *
 * Chaque chiffre s'ecrit sur sept modules selon trois jeux — L et G a gauche
 * du milieu, R a droite. Le premier chiffre d'un EAN-13 ne se dessine pas :
 * il se lit dans l'alternance L / G des six suivants.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Clef de controle d'un EAN : poids 3 et 1 en alternance, depuis la droite. */
export function checkDigit(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    sum += Number(digits[i]) * ((digits.length - i) % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * SVG du code, ou null quand il ne se dessine pas honnetement : longueur
 * inconnue de la norme ou clef fausse. Mieux vaut n'afficher que les
 * chiffres qu'un code-barres qui ne correspondrait a aucun boitier.
 */
export function barcodeSvg(ean) {
  let code = String(ean || '').replace(/\D/g, '');
  if (code.length === 12) code = `0${code}`;
  if (code.length !== 13 && code.length !== 8) return null;
  if (checkDigit(code.slice(0, -1)) !== Number(code.at(-1))) return null;

  const long = code.length === 13;
  let pattern = '101';
  if (long) {
    const parity = PARITY[code[0]];
    for (let i = 1; i <= 6; i += 1) pattern += (parity[i - 1] === 'L' ? L : G)[code[i]];
    pattern += '01010';
    for (let i = 7; i <= 12; i += 1) pattern += R[code[i]];
  } else {
    for (let i = 0; i < 4; i += 1) pattern += L[code[i]];
    pattern += '01010';
    for (let i = 4; i < 8; i += 1) pattern += R[code[i]];
  }
  pattern += '101';

  const margin = long ? 11 : 7;
  const width = margin + pattern.length + 7;
  const middle = long ? 45 : 31;
  const guards = [[0, 2], [middle, middle + 4], [pattern.length - 3, pattern.length - 1]];

  const bars = [];
  for (let x = 0; x < pattern.length; x += 1) {
    if (pattern[x] !== '1') continue;
    let end = x;
    while (pattern[end + 1] === '1') end += 1;
    const guard = guards.some(([a, b]) => x >= a && end <= b);
    bars.push(`<rect x="${margin + x}" y="0" width="${end - x + 1}" height="${guard ? 45 : 40}"/>`);
    x = end;
  }

  const group = (text, start, modules) =>
    `<text x="${margin + start + modules / 2}" y="55" text-anchor="middle"
      textLength="${modules - 4}" lengthAdjust="spacing">${text}</text>`;
  const digits = long
    ? `<text x="${margin - 6}" y="55" text-anchor="middle">${code[0]}</text>`
      + group(code.slice(1, 7), 3, 42) + group(code.slice(7), 50, 42)
    : group(code.slice(0, 4), 3, 28) + group(code.slice(4), 36, 28);

  return `<svg class="ean-barres" viewBox="0 0 ${width} 57" role="img" aria-label="Code-barres ${code}">
    <g shape-rendering="crispEdges">${bars.join('')}</g>${digits}</svg>`;
}
