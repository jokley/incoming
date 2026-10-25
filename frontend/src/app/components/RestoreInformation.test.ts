import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
let server: ViteDevServer;
let Information: React.ElementType;
before(async () => {
  server = await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},esbuild:{jsx:'automatic'}});
  Information = (await server.ssrLoadModule('/src/app/components/DatabaseBackups.tsx')).RestoreInformation;
});
after(async () => server?.close());
test('normal operation explains server maintenance and global restore scope before any action', () => {
  const html = renderToStaticMarkup(createElement(Information,{filename:'manual.dump.gz',maintenanceMode:false,canRestore:false}));
  for (const text of ['manual.dump.gz','Wartungsmodus ist nicht aktiv','DATABASE_MAINTENANCE_MODE=true','Backenddienst mit dieser Konfiguration neu erstellen/starten','aller Championship-Events','Sicherheitsbackup','startet keinen Restore']) assert.ok(html.includes(text),text);
});
test('maintenance alone does not confer restore permission', () => {
  const html = renderToStaticMarkup(createElement(Information,{maintenanceMode:true,canRestore:false}));
  assert.ok(html.includes('Keine Berechtigung zur Wiederherstellung'));
});
test('authorized maintenance retains backup and global-impact warnings', () => {
  const html = renderToStaticMarkup(createElement(Information,{maintenanceMode:true,canRestore:true}));
  assert.ok(html.includes('Sicherheitsbackup'));
  assert.ok(html.includes('aller Championship-Events'));
  assert.ok(!html.includes('Wartungsmodus ist nicht aktiv'));
  assert.ok(!html.includes('Keine Berechtigung'));
});
