/**
 * Lecture / ecriture CSV conformes a la RFC 4180 (guillemets doubles echappes,
 * separateurs et sauts de ligne autorises a l'interieur d'un champ cite).
 * Ecrit a la main pour eviter une dependance supplementaire.
 */

/** Decoupe un texte CSV en tableau de tableaux. */
export function parseCsv(text, delimiter = ',') {
  const input = String(text ?? '').replace(/^﻿/, ''); // retire le BOM Excel
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Detecte le separateur le plus probable sur la premiere ligne. */
export function detectDelimiter(text) {
  const firstLine = String(text ?? '').split(/\r?\n/)[0] || '';
  const counts = [',', ';', '\t'].map((d) => ({
    d,
    n: firstLine.split(d).length - 1,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

/** Transforme un CSV en objets, en utilisant la premiere ligne comme en-tetes. */
export function csvToObjects(text) {
  const rows = parseCsv(text, detectDelimiter(text));
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      if (header) obj[header] = (cells[index] ?? '').trim();
    });
    return obj;
  });
}

const escapeCell = (value) => {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Serialise des objets en CSV, avec BOM pour un ouverture propre dans Excel. */
export function objectsToCsv(rows, columns) {
  const header = columns.map(escapeCell).join(',');
  const body = rows.map((row) => columns.map((col) => escapeCell(row[col])).join(','));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}
