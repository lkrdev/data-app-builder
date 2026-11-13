const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const {
  bundlePath,
  codemodePath,
  imageSnapshotsDir,
  buildHtmlPage,
  startHeadlessChrome,
  scenarios,
  writeSnapshotManifest
} = require('./visual/mockHarness')
const { registerVisualPart01Tests } = require('./visual/part01')
const { registerVisualPart02Tests } = require('./visual/part02')
const { registerVisualPart03Tests } = require('./visual/part03')
const { registerVisualPart04Tests } = require('./visual/part04')
const { registerVisualPart05Tests } = require('./visual/part05')
const { registerVisualPart06Tests } = require('./visual/part06')
const { registerVisualPart07Tests } = require('./visual/part07')
const { registerVisualPart08Tests } = require('./visual/part08')
const { registerVisualPart09Tests } = require('./visual/part09')
const { registerVisualPart10Tests } = require('./visual/part10')
const { registerVisualPart11Tests } = require('./visual/part11')
const { registerVisualPart12Tests } = require('./visual/part12')

describe('Agent — Mini-App, Config, Dropdown & Chat Bar Visual Snapshot Suite', () => {
  let server
  const ctx = {
    port: 0,
    chrome: null,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    path,
    imageSnapshotsDir,
    scenarios,
    startHeadlessChrome,
    writeSnapshotManifest
  }

  beforeAll(async () => {
    expect(existsSync(bundlePath)).toBe(true)
    const bundleContent = readFileSync(bundlePath)
    const codemodeContent = readFileSync(codemodePath)
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname === '/codemode.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=3600'
        })
        res.end(codemodeContent)
        return
      }
      if (url.pathname === '/bundle.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=3600'
        })
        res.end(bundleContent)
        return
      }
      const scenario = url.searchParams.get('scenario') || 'data_app'
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(buildHtmlPage(scenario))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    ctx.port = server.address().port
    ctx.chrome = await startHeadlessChrome()
  }, 20000)

  afterAll(async () => {
    if (ctx.chrome) ctx.chrome.close()
    if (server) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
    try {
      writeSnapshotManifest()
    } catch {
      /* ignore */
    }
  })

  registerVisualPart01Tests(ctx)
  registerVisualPart02Tests(ctx)
  registerVisualPart03Tests(ctx)
  registerVisualPart04Tests(ctx)
  registerVisualPart05Tests(ctx)
  registerVisualPart06Tests(ctx)
  registerVisualPart07Tests(ctx)
  registerVisualPart08Tests(ctx)
  registerVisualPart09Tests(ctx)
  registerVisualPart10Tests(ctx)
  registerVisualPart11Tests(ctx)
  registerVisualPart12Tests(ctx)
})
