import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { Readable } = require('node:stream')

const root = process.env.TEST_HOME
const sessionId = 'session-11111111-2222-3333-4444-555555555555'
const routes = new Map()
const archived = []
const unarchived = []
let live = false

const fakeRegistry = {
  async archiveSession(id, options) {
    archived.push({ id, options })
  },
  async unarchiveSession(id) {
    unarchived.push(id)
  },
}

const ctx = {
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
    getOrigin: () => 'http://127.0.0.1:15867',
  },
  effect(fn) { return fn() },
  get(name) {
    if (name === 'workspaceRegistry') return fakeRegistry
    if (name === 'sessions') return { get: (id) => (live && id === sessionId ? { id } : undefined) }
    return undefined
  },
}

const module = await import(pathToFileURL(process.env.PLUGIN_INDEX).href)
module.apply(ctx)

function call(path, method, body) {
  const route = routes.get(path)
  if (!route) throw new Error(`missing route ${path}`)
  return new Promise((resolve) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    req.method = method
    req.headers = {}
    const res = {
      status: 0,
      payload: undefined,
      writableEnded: false,
      writeHead(status) { this.status = status },
      end(text) { this.writableEnded = true; this.payload = text; resolve({ status: this.status, body: JSON.parse(text) }) },
    }
    route.handler(req, res)
  })
}

const checks = []
function check(name, condition, extra) {
  checks.push({ name, ok: Boolean(condition), extra })
  if (!condition) console.log('FAIL', name, extra ?? '')
}

const sessionDir = join(root, 'sessions', '--F-demo--', sessionId)
const cacheFile = join(root, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
await mkdir(sessionDir, { recursive: true })
await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), 'log-bytes')
await mkdir(join(root, 'storages', 'session_projcache', 'sessions'), { recursive: true })
await writeFile(cacheFile, '{"title":"demo"}')

const deleted = await call('/local-chat-trash/delete', 'POST', { sessionId })
check('delete status 200', deleted.status === 200, deleted)
check('archive called with stopActivity', archived.length === 1 && archived[0].options.stopActivity === true, archived)
check('session directory moved away', await stat(sessionDir).then(() => false, () => true))
check('projection cache removed', await stat(cacheFile).then(() => false, () => true))

const status1 = await call('/local-chat-trash/status', 'GET')
check('trash count is 1', status1.body.count === 1, status1.body)

const trashDir = join(root, 'trash', 'chat-trash')
const names = (await import('node:fs/promises')).readdir ? await (await import('node:fs/promises')).readdir(trashDir) : []
check('one trash entry', names.length === 1, names)
const entry = join(trashDir, names[0])
const manifest = JSON.parse(await readFile(join(entry, 'trash.json'), 'utf8'))
check('manifest names the original path', manifest.originalPath === sessionDir, manifest)
check('log survived the move', (await readFile(join(entry, 'session.v4.jsonl.zstd'), 'utf8')) === 'log-bytes')

live = true
await mkdir(sessionDir, { recursive: true })
await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), 'second')
const refused = await call('/local-chat-trash/delete', 'POST', { sessionId })
check('open chat refused with 409', refused.status === 409, refused)
check('refusal left the log in place', await stat(join(sessionDir, 'session.v4.jsonl.zstd')).then(() => true, () => false))
live = false

const bad = await call('/local-chat-trash/delete', 'POST', { sessionId: '../../etc/passwd' })
check('path-like id refused', bad.status === 400, bad)

const purge = await call('/local-chat-trash/purge', 'POST', {})
check('purge removed one entry', purge.body.removed === 1, purge.body)
const status2 = await call('/local-chat-trash/status', 'GET')
check('trash empty after purge', status2.body.count === 0, status2.body)

await rm(join(root, 'sessions'), { recursive: true, force: true })
const missing = await call('/local-chat-trash/delete', 'POST', { sessionId })
check('missing log answers 404', missing.status === 404, missing)

const failed = checks.filter((c) => !c.ok)
console.log(JSON.stringify({ total: checks.length, failed: failed.length, failures: failed }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
