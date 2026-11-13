import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let server: ViteDevServer;
let html: string;
let Guide: any;
let Badges: any;
const rules = {status:'FIXED',revision:1,eventName:'Test WM',fixedAt:'2026-10-23',config:{schemaVersion:1,athletes:{Snowboard:{enabled:true,totalLimit:36,genderLimit:20},Freestyle:{enabled:true,totalLimit:36,genderLimit:20}},officials:{model:'ATHLETES_PLUS',allowance:2},singleRooms:[{upTo:3,rooms:1},{upTo:6,rooms:2},{upTo:null,rooms:3}]},examples:{athletes:4,officials:6,singleRooms:2,scale:['1–3 Officials → 1 EZ','4–6 Officials → 2 EZ','ab 7 Officials → 3 EZ'],rows:[{name:'Person A im EZ',used:1,covered:true,progress:50,label:'1 / 2 genutzt'},{name:'Person B im EZ',used:2,covered:true,progress:100,label:'2 / 2 genutzt'},{name:'Zusätzliche EZ-Nutzung',used:3,covered:false,progress:100,label:'Quote überschritten'}]}};
before(async () => {
  server = await createServer({ configFile: false, cacheDir: fileURLToPath(new URL('../../../../node_modules/.vite-fis-guide', import.meta.url)), root: fileURLToPath(new URL('../../..', import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, esbuild: { jsx: 'automatic' } });
  const { FisRulesPanel } = await server.ssrLoadModule('/src/app/components/FisRulesPanel.tsx');
  Guide=FisRulesPanel;
  Badges = (await server.ssrLoadModule('/src/app/components/SingleRoomStatusBadge.tsx')).SingleRoomAssignmentBadges;
  html = renderToStaticMarkup(createElement(FisRulesPanel,{rules}));
});
after(async () => { await server?.close(); });

test('renders an accessible numbered guide with all eleven sections', () => {
  assert.match(html, /<article[^>]*aria-labelledby="fis-title"/);
  assert.match(html, /FIS Unterkunft &amp; Quoten/);
  assert.equal((html.match(/<section /g) || []).length, 11);
  for (const title of ['Quotenkontext', 'Wichtigster Merksatz', 'Konkretes Beispiel', 'DZ-Wunsch, aber im EZ untergebracht', 'Diese Dinge nicht vermischen', 'Wenn du dich fragst', 'Was ist eine Event Group?', 'Welche Officials-Arten gibt es?', 'Sonderfälle', 'Quellen / FIS Rules']) assert.ok(html.includes(title), title);
});
test('shows the quota example and keeps pending, approval and tariff separate', () => {
  for (const text of ['4 Athleten', 'Officials-Basis = 6', '2 EZ erlaubt', '1 / 2 genutzt', '2 / 2 genutzt', 'PENDING_APPROVAL', 'APPROVED_EXTRA', 'noch kein EZ-Mehrpreis', 'nicht nach dem Zeitpunkt der Zuweisung', 'Sondertarif ≠ EZ-Mehrpreis', 'Mehrpreis: nicht anwendbar']) assert.ok(html.includes(text), text);
});
test('renders all FAQ answers and complete expandable competition reference', () => {
  assert.match(html, /<dl class="fis-faq">/);
  assert.ok(html.includes('Warum hat ein DZ Mehrpreis?'));
  assert.equal((html.match(/<details /g) || []).length, 6);
  assert.equal((html.match(/<h3><svg[^]*?<\/h3>/g) || []).filter(heading => heading.includes('Freestyle / Freeski') || heading.includes('Snowboard')).length, 2);
  assert.ok(!html.includes('</svg>Freeski</h3>'));
  assert.ok(!html.includes('</svg>Freestyle Ski</h3>'));
  for (const name of ['Snowboard Alpine', 'Snowboard Park &amp; Pipe', 'Snowboard Cross', 'Freeski Park &amp; Pipe', 'Freestyle', 'Ski Cross', 'Mixed Parallel Team', 'Dual Moguls Team', 'Aerials Team', 'Ski Cross Team']) assert.ok(html.includes(name), name);
});
test('distinguishes FIS official categories from raw imported Function', () => {
  for (const text of ['Regular Officials', 'Extra Officials', 'Special Guests', 'President / Secretary General', 'Service Personnel', 'NSA Guest ≠ automatisch Special Guest', 'No room ≠ External']) assert.ok(html.includes(text), text);
});
test('provides printable source references without invented URLs', () => {
  for (const reference of ['9.1.3', '9.1.5', '9.1.7', '13.1', '13.2', '13.3']) assert.ok(html.includes(`data-fis-reference="${reference}"`));
  assert.ok(!html.includes('href='));
  assert.ok(!html.includes('<img'));
});
test('scopes responsive, theme-aware and print styling to the poster', () => {
  const css = readFileSync(new URL('./FisRulesPanel.css', import.meta.url), 'utf8');
  assert.match(css, /@container \(max-width: 700px\)/);
  assert.match(css, /var\(--ops-surface\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /size: A3 landscape/);
  assert.match(css, /break-inside: avoid/);
  assert.match(css, /details > ul \{ display: block !important/);
});


test('draft policy never presents defaults as binding rules',()=>{
  const draft=renderToStaticMarkup(createElement(Guide,{rules:{status:'DRAFT',config:null}}));
  assert.match(draft,/noch keine verbindlichen/);assert.ok(!draft.includes('36 Athleten'));assert.ok(!draft.includes('Officials-Basis = 6'));
});
test('guide uses server examples and configured family limits',()=>{
  const custom=structuredClone(rules);custom.config.officials.allowance=5;custom.examples.officials=9;custom.examples.singleRooms=4;custom.config.athletes.Snowboard.totalLimit=42;
  const customHtml=renderToStaticMarkup(createElement(Guide,{rules:custom}));
  assert.match(customHtml,/Officials-Basis = 9/);assert.match(customHtml,/42 Athleten gesamt/);assert.match(customHtml,/4 EZ erlaubt/);assert.ok(!customHtml.includes('Officials-Basis = 6'));
});

test('guide states the current basis and separates valid, free, open and historical decisions', () => {
  for (const text of ['Officials-Limit, nicht die Zahl gemeldeter', 'fachliche Regelbestätigung', 'aktuell anwendbare kostenpflichtige Genehmigung', 'gültige kostenfreie Ausnahme', 'inaktiv erhalten', 'offene Entscheidung ist noch kein genehmigter Mehrpreis']) assert.ok(html.includes(text), text);
});

test('operational badges render all current and historical states with explanatory tooltips', () => {
  const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Badges, props));
  const covered = render({countsAsSingle:true,status:'PENDING_APPROVAL',allocationStatus:'COVERED'});
  assert.match(covered, /EZ in Quote/); assert.ok(!covered.includes('Entscheidung offen'));
  const paid = render({countsAsSingle:true,status:'APPROVED_EXTRA',allocationStatus:'APPROVED_EXTRA',activeSurcharge:true,approvalApplicable:true});
  assert.match(paid, /Mehrpreis/); assert.ok(!paid.includes('prüfen'));
  const free = render({countsAsSingle:true,status:'NONE',allocationStatus:'EXEMPT',exemptReason:'OTHER'});
  assert.match(free, /Gültige kostenfreie EZ-Ausnahme/); assert.ok(!free.includes('Mehrpreis'));
  const pending = render({countsAsSingle:true,status:'IN_QUOTA',allocationStatus:'PENDING'});
  assert.match(pending, /Entscheidung offen/); assert.match(pending, /noch kein genehmigter EZ-Mehrpreis/);
  const inactive = render({countsAsSingle:false,status:'APPROVED_EXTRA',approvalApplicable:true});
  assert.match(inactive, /EZ-Genehmigung inaktiv/); assert.match(inactive, /Genehmigung bleibt erhalten/);
  const invalid = render({countsAsSingle:true,status:'APPROVED_EXTRA',allocationStatus:'PENDING',approvalApplicable:false});
  assert.match(invalid, /EZ-Genehmigung prüfen/); assert.match(invalid, /Entscheidung offen/); assert.ok(!invalid.includes('>Mehrpreis<'));
});
