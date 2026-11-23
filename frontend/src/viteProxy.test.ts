import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer, loadConfigFromFile } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url))

test('dev proxy strips external identity and preserves API requests', async (t) => {
  const upstream = createHttpServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ headers: req.headers, url: req.url, method: req.method, body }))
    })
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve())))
  const previousBase = process.env.VITE_BASE_PATH
  const previousTarget = process.env.VITE_API_PROXY_TARGET
  t.after(() => {
    if (previousBase === undefined) delete process.env.VITE_BASE_PATH
    else process.env.VITE_BASE_PATH = previousBase
    if (previousTarget === undefined) delete process.env.VITE_API_PROXY_TARGET
    else process.env.VITE_API_PROXY_TARGET = previousTarget
  })
  process.env.VITE_BASE_PATH = '/absproxy/5173/'
  process.env.VITE_API_PROXY_TARGET = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  const vite = await createServer({
    root, configFile,
    // Avoid a background dependency scan during proxy and HMR checks.
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, open: false },
  })
  t.after(() => vite.close())
  await vite.listen()
  const port = (vite.httpServer!.address() as AddressInfo).port
  const origin = `http://127.0.0.1:${port}`
  for (const path of ['/absproxy/5173/', '/absproxy/5173/administration/database']) {
    const page = await fetch(origin + path)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /\/absproxy\/5173\/@vite\/client/)
  }
  const websocket = new WebSocket(`${origin.replace('http:', 'ws:')}/absproxy/5173/?token=${vite.config.webSocketToken}`, 'vite-hmr')
  await new Promise<void>((resolve, reject) => {
    websocket.addEventListener('message', (event) => {
      if (JSON.parse(String(event.data)).type === 'connected') resolve()
    })
    websocket.addEventListener('error', () => reject(new Error('HMR websocket failed')))
    t.after(() => websocket.close())
  })
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const response = await fetch(`http://127.0.0.1:${port}/absproxy/5173/api/active-event-context?event=1&value=a%2Fb`, {
      method,
      headers: {
        'X-Authenticated-User': 'external-user',
        'X-Authenticated-Groups': 'incoming-admin',
        'X-Auth-Proxy-Secret': 'dummy',
        'X-Authenticated-Name': 'External User',
        'X-Authenticated-Email': 'external@example.test',
        'X-Regression-Header': 'preserved',
        'Content-Type': 'application/json',
      },
      ...(method === 'GET' ? {} : { body: '{"event":1}' }),
    })
    assert.equal(response.status, 200)
    const received = await response.json()
    for (const name of ['x-authenticated-user', 'x-authenticated-groups', 'x-auth-proxy-secret', 'x-authenticated-name', 'x-authenticated-email']) {
      assert.equal(received.headers[name], undefined, name)
    }
    assert.equal(received.headers['x-regression-header'], 'preserved')
    assert.equal(received.headers['content-type'], 'application/json')
    assert.equal(received.url, '/api/active-event-context?event=1&value=a%2Fb')
    assert.equal(received.method, method)
    assert.equal(received.body, method === 'GET' ? '' : '{"event":1}')
  }
  delete process.env.VITE_BASE_PATH
  const buildConfig = await loadConfigFromFile({ command: 'build', mode: 'production' }, configFile, root)
  assert.equal(buildConfig!.config.base, '/')
})

test('base-prefixed API fallback and generation reload remain inside the application', async (t) => {
  const base = '/absproxy/5173/'
  const vite = await createServer({
    root, configFile: false, envFile: false, base, logLevel: 'silent',
    define: { 'import.meta.env.VITE_API_URL': 'undefined' },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  })
  t.after(() => vite.close())
  const destinations: string[] = []
  const previousWindow = globalThis.window
  Object.assign(globalThis, { window: { location: { assign: (url: string) => destinations.push(url) } } })
  t.after(() => {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
    else globalThis.window = previousWindow
  })
  const { api } = await vite.ssrLoadModule('/src/app/services/api.ts')
  let generation = 'before'
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), `${base}api/auth/me`)
    return Response.json({}, { headers: { 'X-Database-Generation': generation } })
  })
  await api.getCurrentUser()
  generation = 'after'
  await assert.rejects(api.getCurrentUser(), /Datenbank/)
  assert.deepEqual(destinations, [base])
})
