import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// All API requests are intercepted: these tests never use TEST data or restore.
test('backup page publishes imports, refreshes metadata and rejects invalid success bodies', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const base = '/absproxy/5173/';
  const vite = await createServer({ root, configFile: `${root}vite.config.ts`, envFile: false,
    base, define: { 'import.meta.env.VITE_API_URL': JSON.stringify(`${base}api`) },
    cacheDir: await mkdtemp(`${tmpdir()}/incoming-backup-browser-`),
    optimizeDeps: { include: ['react', 'react-dom/client', 'react-router', '@mui/material'] },
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false, ws: false },
  });
  t.after(() => vite.close());
  await vite.listen();
  const browser = await chromium.launch({headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => console.error('Backup browser page error:', error.message));
  const counts = new Map<string, number>();
  const overrides = new Map<string, {status: number; contentType: string; body: string}>();
  let imported = false;
  let restoreCalls = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.slice(`${base}api`.length);
    counts.set(path, (counts.get(path) ?? 0) + 1);
    if (path === '/admin/database/restore') restoreCalls++;
    const override = overrides.get(path);
    if (override) { await route.fulfill(override); return; }
    const bodies: Record<string, unknown> = {
      '/auth/me': {username:'local-admin', displayName:'local-admin', groups:['incoming-admin'], permissions:['*']},
      '/active-event-context': {events:[{id:'1',name:'WSC Montafon 2027',active:true,canRead:true,canWrite:true}], selectedEventId:'1', switchingAllowed:false},
      '/admin/database/status': {databaseStatus:'available', postgresVersion:'17.11', alembicVersion:'20261028_01',
        databaseSize:imported ? 12000000 : 10000000, backupCount:1, backupStatus:'success', backupSize:200000,
        lastBackup:{status:'success',created:'2026-11-09T06:12:12Z'}, capabilities:{create:true,upload:true,download:true,restore:true}},
      '/admin/database/backups': [{category:'manual',filename:'existing.dump.gz',size:200000,modified:1794204733}],
      '/admin/database/restore-status': {state:'IDLE',formatVersion:1},
    };
    if (path === '/admin/database/import') {
      imported = true;
      await route.fulfill({status:201,json:{filename:'uploaded.dump',size:5,modified:1794204733,token:'test-token',local:true}});
      return;
    }
    await route.fulfill({status:path in bodies ? 200 : 404,json:bodies[path] ?? {error:'Unexpected test request'}});
  });
  const url = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}${base}administration/database`;
  const open = async () => {
    try { await page.goto(url, {waitUntil:'domcontentloaded',timeout:30000}); }
    catch (error) { console.error('Backup browser state:', await page.locator('body').innerText()); throw error; }
    await page.getByRole('button',{name:'Backup importieren',exact:true}).waitFor();
  };
  const upload = async () => {
    await page.locator('input[type=file]').setInputFiles({name:'uploaded.dump',mimeType:'application/octet-stream',buffer:Buffer.from('PGDMP')});
  };
  await t.test('initial fetch renders data; successful upload remains visible and re-fetches all metadata', async () => {
    await open();
    await page.getByText('17.11',{exact:true}).waitFor();
    await page.getByRole('button',{name:'existing.dump.gz herunterladen',exact:true}).waitFor();
    await upload();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
    await page.getByText('uploaded.dump',{exact:true}).waitFor({timeout:4000});
    for (const path of ['/admin/database/status','/admin/database/backups','/admin/database/restore-status']) {
      assert.ok((counts.get(path) ?? 0) >= 2, `${path} must refresh after import`);
    }
    await page.getByText('12 MB',{exact:true}).waitFor();
    const before = counts.get('/admin/database/status')!;
    await page.getByRole('button',{name:'Backupdaten aktualisieren',exact:true}).click();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="Backupdaten aktualisieren"][disabled]'));
    assert.ok(counts.get('/admin/database/status')! > before);
  });
  await t.test('HTML and empty metadata replies produce visible errors rather than empty success state', async () => {
    overrides.set('/admin/database/status',{status:200,contentType:'text/html',body:'<html>Login</html>'});
    overrides.set('/admin/database/backups',{status:200,contentType:'application/json',body:''});
    await open();
    await page.getByText(/Datenbankinformationen sind derzeit nicht verfügbar/).waitFor();
    await page.getByText(/Die Backupliste ist derzeit nicht verfügbar/).waitFor();
    assert.equal(await page.getByText('Noch kein Backup vorhanden.',{exact:true}).count(),0);
    overrides.clear();
  });
  await t.test('invalid upload success cannot publish an import or claim success', async () => {
    // Empty/null/malformed payloads are also covered by databaseMetadata.test.ts.
    overrides.set('/admin/database/import',{status:201,contentType:'text/html',body:'<html>Login</html>'});
    await open();
    await upload();
    await page.getByText('Ungültige Antwort für den Backup-Import.',{exact:true}).waitFor({timeout:4000});
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.getByText(/Das lokale Backup wurde geprüft/).count(),0);
  });
  assert.equal(restoreCalls,0);
});
