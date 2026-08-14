import type { ListKind, ListRow } from './listEngine';

const columns: Array<[keyof ListRow, string]> = [
  ['hotel', 'Hotel'], ['room', 'Zimmer'], ['roomType', 'Zimmerart'], ['name', 'Name'],
  ['nation', 'Nation'], ['discipline', 'Disziplin / Event'], ['role', 'Funktion'],
  ['arrival', 'Anreise'], ['departure', 'Abreise'], ['firstMeal', 'First Meal'],
  ['lastMeal', 'Last Meal'], ['specialMeal', 'Special Meal'], ['lateCheckout', 'Late Checkout'],
  ['surcharge', 'Mehrpreis'], ['roommate', 'Zimmerpartner'],
];

const download = (blob: Blob, filename: string) => {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
};
const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function exportExcel(rows: ListRow[], kind: ListKind) {
  const table = `<table><thead><tr>${columns.map(([, label]) => `<th>${xml(label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map(([key]) => `<td>${xml(String(row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  download(new Blob([`\ufeff<html><meta charset="utf-8"><body>${table}</body></html>`], { type: 'application/vnd.ms-excel' }), `listen-${kind}.xls`);
}

const pdfEscape = (text: string) => text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)').replace(/[^\x20-\xFF]/g, '?');
export function exportPdf(rows: ListRow[], kind: ListKind) {
  const lines = [`Listen · ${kind === 'hotels' ? 'Hotels' : 'Nationen'}`, `Stand: ${new Date().toLocaleString('de-DE')} · ${rows.length} Personen`, '', ...rows.flatMap((row) => [
    `${row.hotel} | Zi. ${row.room} | ${row.name} | ${row.nation} | ${row.discipline}`,
    `  ${row.arrival || '-'} - ${row.departure || '-'} | ${row.role} | Partner: ${row.roommate}`,
  ])];
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 47) pages.push(lines.slice(index, index + 47));
  const objects: string[] = [''];
  const add = (body: string) => (objects.push(body), objects.length - 1);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  pages.forEach((page) => {
    const stream = `BT /F1 9 Tf 35 806 Td 0 -16 Td ${page.map((line) => `(${pdfEscape(line.slice(0, 120))}) Tj 0 -16 Td`).join(' ')} ET`;
    contentIds.push(add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    pageIds.push(add(''));
  });
  const pagesId = add('');
  pageIds.forEach((id, index) => { objects[id] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`; });
  objects[pagesId] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.slice(1).forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer << /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  download(new Blob([new Uint8Array([...pdf].map((character) => character.charCodeAt(0) & 255))], { type: 'application/pdf' }), `listen-${kind}.pdf`);
}
