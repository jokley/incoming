import type { ContingentRow, ListKind, ListRow } from './listEngine';

const columns: Array<[keyof ListRow, string]> = [
  ['hotel', 'Hotel'], ['room', 'Zimmer'], ['roomType', 'Zimmerart'], ['name', 'Name'],
  ['nation', 'Nation'], ['discipline', 'Disziplin / Event'], ['role', 'Funktion'],
  ['arrival', 'Anreise'], ['departure', 'Abreise'], ['firstMeal', 'First Meal'],
  ['lastMeal', 'Last Meal'], ['specialMeal', 'Special Meal'], ['lateCheckout', 'Late Checkout'],
  ['surcharge', 'Mehrpreis'], ['roommate', 'Zimmerpartner'],
  ['remark', 'Bemerkung'],
];

const download = (blob: Blob, filename: string) => {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
};
const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  bytes.forEach(byte => { crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); });
  return (crc ^ 0xffffffff) >>> 0;
};
const u16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
const u32 = (value: number) => [...u16(value & 0xffff), ...u16(value >>> 16)];

/** Creates a standards-compliant, store-only ZIP container without adding a heavy export dependency. */
function zip(files: Array<[string, string]>) {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  let offset = 0;
  files.forEach(([name, contents]) => {
    const filename = encoder.encode(name);
    const data = encoder.encode(contents);
    const crc = crc32(data);
    const header = [0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(filename.length), ...u16(0)];
    local.push(...header, ...filename, ...data);
    central.push(0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(filename.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...filename);
    offset += header.length + filename.length + data.length;
  });
  const end = [0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(central.length), ...u32(local.length), ...u16(0)];
  return new Uint8Array([...local, ...central, ...end]);
}

export function exportExcel(rows: ListRow[], kind: ListKind) {
  const cells = (values: string[]) => values.map((value, index) => `<c r="${String.fromCharCode(65 + index)}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('');
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells(columns.map(([, label]) => label))}</row>${rows.map((row, index) => `<row r="${index + 2}">${cells(columns.map(([key]) => String(row[key])))}</row>`).join('')}</sheetData></worksheet>`;
  const files: Array<[string, string]> = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Liste" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', worksheet],
  ];
  download(new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `listen-${kind}.xlsx`);
}

export function exportContingentsExcel(rows: ContingentRow[]) {
  const contingentColumns: Array<[keyof ContingentRow, string]> = [
    ['hotel', 'Hotel'], ['roomType', 'Zimmerart'], ['region', 'Region'], ['availableFrom', 'Von'], ['availableUntil', 'Bis'],
    ['totalRooms', 'Zimmer'], ['totalBeds', 'Betten'], ['freeRooms', 'Freie Zimmer'], ['freeBeds', 'Freie Betten'],
    ['occupiedRooms', 'Belegte Zimmer'], ['occupiedBeds', 'Belegte Betten'], ['occupancy', 'Auslastung %'],
    ['hasHalfBoard', 'HP'], ['hasSR', 'SR'], ['contactPerson', 'Ansprechpartner'],
    ['phone', 'Telefon'], ['email', 'E-Mail'], ['comment', 'Kontingent-Kommentar'],
  ];
  const cells = (values: string[]) => values.map((value, index) => `<c r="${String.fromCharCode(65 + index)}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('');
  const display = (row: ContingentRow, key: keyof ContingentRow) => key === 'hasHalfBoard' || key === 'hasSR' ? (row[key] ? 'Ja' : 'Nein') : key === 'occupancy' ? row.occupancy.toFixed(0) : String(row[key]);
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells(contingentColumns.map(([, label]) => label))}</row>${rows.map((row, index) => `<row r="${index + 2}">${cells(contingentColumns.map(([key]) => display(row, key)))}</row>`).join('')}</sheetData></worksheet>`;
  const files: Array<[string, string]> = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Kontingente" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', worksheet],
  ];
  download(new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'kontingente.xlsx');
}
