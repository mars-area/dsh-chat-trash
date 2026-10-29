import { existsSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { Readable } = require('node:stream')

const root = process.env.TEST_HOME
const sessionId = 'session-11111111-2222-3333-4444-555555555555'
const routes = new Map()
const calls = {
  stop: [],
  unpin: [],
  unarchive: [],
  detach: [],
  detached: 0,
  archive: 0,
  logExistedAtDetach: null,
}
let live = false

const sessionDir = join(root, 'sessions', '--F-demo--', sessionId)
const cacheFile = join(root, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
const logFile = join(sessionDir, 'session.v4.jsonl.zstd')

const liveSession = { id: sessionId }

const store = {
  get(id) {
    return live && id === sessionId ? liveSession : undefined
  },
  liveEntryFor(session) {
    return { id: session.id }
  },
  detachEntered() {
    calls.detached += 1
    calls.logExistedAtDetach = existsSync(logFile)
    live = false
  },
}

const workspace = {
  sessionIds: [sessionId],
  async detachSession(id) {
    calls.detach.push(id)
    this.sessionIds = this.sessionIds.filter((entry) => entry !== id)
  },
}

const fakeRegistry = {
  async archiveSession() {
    calls.archive += 1
    throw new Error('archive must not be used')
  },
  async stopSessionActivity(id) {
    calls.stop.push(id)
  },
  async unpinSession(id) {
    calls.unpin.push(id)
  },
  async unarchiveSession(id) {
    calls.unarchive.push(id)
  },
  list() {
    return [workspace]
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
    if (name === 'sessions') return store
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
      writableEnded: false,
      writeHead(status) { this.status = status },
      end(text) { this.writableEnded = true; resolve({ status: this.status, body: JSON.parse(text) }) },
    }
    route.handler(req, res)
  })
}

const checks = []
function check(name, condition, extra) {
  checks.push({ name, ok: Boolean(condition), extra })
  if (!condition) console.log('FAIL', name, extra ?? '')
}

async function seed() {
  await mkdir(sessionDir, { recursive: true })
  await writeFile(logFile, 'log-bytes')
  await mkdir(join(root, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  await writeFile(cacheFile, '{"title":"demo"}')
}

// 1. A live, opened chat: the store entry must go before the log does.
live = true
await seed()
const deleted = await call('/local-chat-trash/delete', 'POST', { sessionId })
check('delete answers 200', deleted.status === 200, deleted)
check('running work is stopped', calls.stop.includes(sessionId), calls.stop)
check('live session detached from the store', calls.detached === 1, calls.detached)
check('log still present while detaching', calls.logExistedAtDetach === true, calls.logExistedAtDetach)
check('pin cleared', calls.unpin.includes(sessionId), calls.unpin)
check('archive mark cleared', calls.unarchive.includes(sessionId), calls.unarchive)
check('detached from the workspace', calls.detach.includes(sessionId), calls.detach)
check('session directory removed', await stat(sessionDir).then(() => false, () => true))
check('projection cache removed', await stat(cacheFile).then(() => false, () => true))
check('nothing archived', calls.archive === 0, calls.archive)
check('no trash folder created', await stat(join(root, 'trash')).then(() => false, () => true))

// 2. A live chat whose log is already gone (leftovers of an older delete).
live = true
await rm(sessionDir, { recursive: true, force: true })
const orphan = await call('/local-chat-trash/delete', 'POST', { sessionId })
check('a live chat without a log is cleaned up', orphan.status === 200, orphan)
check('its store entry is gone too', calls.detached === 2, calls.detached)

// 3. Refusals.
live = false
const bad = await call('/local-chat-trash/delete', 'POST', { sessionId: '../../etc/passwd' })
check('path-like id refused', bad.status === 400, bad)

await rm(join(root, 'sessions'), { recursive: true, force: true })
const missing = await call('/local-chat-trash/delete', 'POST', { sessionId })
check('an absent chat answers 404', missing.status === 404, missing)

const failedChecks = checks.filter((item) => !item.ok)
console.log(JSON.stringify({ total: checks.length, failed: failedChecks.length, failures: failedChecks }, null, 2))
process.exit(failedChecks.length === 0 ? 0 : 1)
