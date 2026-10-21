import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import { readFileSync } from 'node:fs';

let server: ViteDevServer;
let html: string;
before(async () => {
  server = await createServer({ configFile: false, cacheDir: new URL('../../../../node_modules/.vite-fis-guide', import.meta.url).pathname, root: new URL('../../..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null }, esbuild: { jsx: 'automatic' } });
  const { FisRulesPanel } = await server.ssrLoadModule('/src/app/components/FisRulesPanel.tsx');
  html = renderToStaticMarkup(createElement(FisRulesPanel));
});
after(async () => { await server?.close(); });

test('renders an accessible numbered guide with all ten sections', () => {
  assert.match(html, /<article[^>]*aria-labelledby="fis-title"/);
  assert.match(html, /FIS Unterkunft &amp; Quoten/);
  assert.equal((html.match(/<section /g) || []).length, 10);
  for (const title of ['Quotenkontext', 'Wichtigster Merksatz', 'Konkretes Beispiel', 'DZ-Wunsch, aber im EZ untergebracht', 'Diese Dinge nicht vermischen', 'Wenn du dich fragst', 'Was ist eine Event Group?', 'Welche Officials-Arten gibt es?', 'Sonderfälle', 'Quellen / FIS Rules']) assert.ok(html.includes(title), title);
});
test('shows the quota example and keeps pending, approval and tariff separate', () => {
  for (const text of ['4 Athleten', 'Officials-Basis = 6', '2 EZ erlaubt', '1 / 2 genutzt', '2 / 2 genutzt', 'PENDING_APPROVAL', 'APPROVED_EXTRA', 'noch kein EZ-Mehrpreis', 'nicht nach dem Zeitpunkt der Zuweisung', 'Sondertarif ≠ EZ-Mehrpreis', 'Mehrpreis: nicht anwendbar']) assert.ok(html.includes(text), text);
});
test('renders all FAQ answers and complete expandable competition reference', () => {
  assert.match(html, /<dl class="fis-faq">/);
  assert.ok(html.includes('Warum hat ein DZ Mehrpreis?'));
  assert.equal((html.match(/<details /g) || []).length, 6);
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
