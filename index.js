/**
 * Host half of the chat-trash bundle.
 *
 * A delete is deliberately recoverable. The Session is archived first, so the
 * sidebar drops the row at once through the ordinary Workspace stream, then its
 * stored log moves into `<DSH_HOME>/trash/chat-trash` and its projection-cache
 * row is removed. Nothing here is a supported persistence API: the seam has no
 * delete, so this bundle moves files under it. The browser half owns every
 * button and calls the routes registered below.
 *
 * Made by mars-area — https://github.com/mars-area
 */
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const inject = ['webServer']

const PREFIX = '/local-chat-trash'
const SESSION_ID = /^session-[A-Za-z0-9_-]{8,100}$/
const MAX_BODY = 64 * 1024

class Refusal extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function trashRoot() {
  return join(dshHome(), 'trash', 'chat-trash')
}

function send(res, status, value) {
  if (res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Refusal(413, 'Request body is too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Refusal(400, 'Request body is not valid JSON.'))
      }
    })
    req.on('error', reject)
  })
}

/** Refuse a request a foreign page made; a same-origin page sends no Origin on GET. */
function sameOrigin(ctx, req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return origin === ctx.webServer.getOrigin()
  } catch {
    return true
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Find `<DSH_HOME>/sessions/<workspace-key>/<sessionId>`, or the direct form. */
async function findSessionDirectory(sessionId) {
  const root = join(dshHome(), 'sessions')
  const direct = join(root, sessionId)
  if (await isDirectory(direct)) return direct
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = join(root, entry.name, sessionId)
    if (await isDirectory(candidate)) return candidate
  }
  return undefined
}

async function trashCount() {
  try {
    return (await readdir(trashRoot())).length
  } catch {
    return 0
  }
}

async function deleteChat(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    throw new Refusal(400, 'That is not a Session id.')
  }

  const live = ctx.get('sessions')?.get(sessionId)
  if (live !== undefined) {
    throw new Refusal(409, 'This chat is open. Switch to another chat, then delete this one.')
  }

  const directory = await findSessionDirectory(sessionId)
  if (directory === undefined) {
    throw new Refusal(404, 'No stored log was found for this chat.')
  }

  const registry = ctx.get('workspaceRegistry')
  let archived = false
  if (registry !== undefined) {
    try {
      await registry.archiveSession(sessionId, { stopActivity: true })
      archived = true
    } catch (error) {
      // An unregistered or already-gone Session is still worth deleting; a real
      // archive failure is not, because the row would stay visible.
      if (!/unknown|not found|no such|missing/i.test(String(error?.message ?? ''))) {
        throw new Refusal(500, `Could not archive the chat first: ${error?.message ?? error}`)
      }
    }
  }

  await mkdir(trashRoot(), { recursive: true })
  const destination = join(trashRoot(), `${Date.now()}-${sessionId}`)
  try {
    await rename(directory, destination)
  } catch (error) {
    if (archived) await registry.unarchiveSession(sessionId).catch(() => {})
    throw new Refusal(500, `Could not move the log into the trash: ${error?.message ?? error}`)
  }

  await writeFile(
    join(destination, 'trash.json'),
    JSON.stringify({ sessionId, deletedAt: new Date().toISOString(), originalPath: directory }, null, 2),
    'utf8',
  ).catch(() => {})

  await rm(join(dshHome(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`), { force: true })
    .catch(() => {})

  return { sessionId, trashedAt: destination }
}

async function purgeTrash() {
  const root = trashRoot()
  let names
  try {
    names = await readdir(root)
  } catch {
    return { removed: 0 }
  }
  let removed = 0
  for (const name of names) {
    try {
      await rm(join(root, name), { recursive: true, force: true })
      removed += 1
    } catch {
      // Keep the entry and report what did go; the next attempt retries it.
    }
  }
  return { removed }
}

export function apply(ctx) {
  const route = (path, method, handle) => ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!sameOrigin(ctx, req)) return send(res, 403, { error: 'Cross-origin request refused.' })
      if ((req.method ?? 'GET') !== method) return send(res, 405, { error: `Use ${method}.` })
      try {
        send(res, 200, await handle(req, res))
      } catch (error) {
        const status = error instanceof Refusal ? error.status : 500
        send(res, status, { error: error?.message ?? String(error) })
      }
    },
  }))

  route(`${PREFIX}/status`, 'GET', async () => ({ count: await trashCount() }))

  route(`${PREFIX}/delete`, 'POST', async (req) => {
    const body = await readBody(req)
    return await deleteChat(ctx, body.sessionId)
  })

  route(`${PREFIX}/purge`, 'POST', async () => await purgeTrash())
}
