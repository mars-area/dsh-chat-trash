/**
 * Host half of the chat-trash bundle.
 *
 * Deletes one chat for real: stops its running work, takes the live Session out
 * of the session store, drops its workspace membership, pin and archive marks,
 * then removes the stored log and its projection-cache row. Nothing is archived
 * and nothing is kept in a trash folder.
 *
 * Removing the live Session matters: the sidebar lists live sessions as well as
 * stored ones, so a chat deleted only on disk kept showing under "Ungrouped"
 * until the next launch.
 *
 * DSH has no delete API by design, so this bundle edits the persistence
 * directory behind the seam.
 *
 * Made by mars-area — https://github.com/mars-area
 */
import { readdir, rm, stat } from 'node:fs/promises'
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

/**
 * Remove the live Session from the store. Its `session/disposed` edge makes
 * persistence drain the last events and close the log handle, and the sidebar
 * stops listing it at once instead of waiting for the next launch.
 * Returns false when nothing live held that id.
 */
function closeLiveSession(ctx, sessionId) {
  const store = ctx.get('sessions')
  if (store === undefined) return false

  const session = store.get?.(sessionId)
  if (session === undefined) return false

  try {
    const entry = store.liveEntryFor(session)
    store.detachEntered(entry)
    return true
  } catch {
    // A session that already left the store needs no teardown.
    return false
  }
}

/**
 * Take the chat out of the sidebar: stop the turn and its children, then clear
 * the pin, the workspace membership and any archive mark. Done before the log
 * is removed so a failed removal cannot leave a row pointing at nothing.
 */
async function forgetSession(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return

  await registry.stopSessionActivity(sessionId)
  await registry.unpinSession(sessionId).catch(() => {})

  for (const workspace of registry.list()) {
    if (workspace.sessionIds.includes(sessionId)) {
      await workspace.detachSession(sessionId).catch(() => {})
    }
  }

  // A previously archived chat would otherwise stay in the archived view.
  await registry.unarchiveSession(sessionId).catch(() => {})
}

async function deleteChat(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    throw new Refusal(400, 'That is not a Session id.')
  }

  const directory = await findSessionDirectory(sessionId)
  const store = ctx.get('sessions')
  const live = store?.get?.(sessionId) !== undefined

  if (directory === undefined && !live) {
    throw new Refusal(404, 'This chat is already gone.')
  }

  await forgetSession(ctx, sessionId)
  closeLiveSession(ctx, sessionId)

  if (directory !== undefined) {
    try {
      await rm(directory, { recursive: true, force: true })
      await rm(join(dshHome(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`), {
        force: true,
      })
    } catch (error) {
      throw new Refusal(
        500,
        `The chat left the sidebar, but its log could not be removed: ${error?.message ?? error}`,
      )
    }
  }

  return { sessionId }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/delete`,
    handler: async (req, res) => {
      if (!sameOrigin(ctx, req)) return send(res, 403, { error: 'Cross-origin request refused.' })
      if ((req.method ?? 'GET') !== 'POST') return send(res, 405, { error: 'Use POST.' })
      try {
        const body = await readBody(req)
        send(res, 200, await deleteChat(ctx, body.sessionId))
      } catch (error) {
        const status = error instanceof Refusal ? error.status : 500
        send(res, status, { error: error?.message ?? String(error) })
      }
    },
  }))
}
