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
