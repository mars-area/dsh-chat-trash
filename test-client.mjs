/**
 * Standalone check of the browser half: it evaluates client.js against a stub
 * module loader and asserts the rows the Slots API receives.
 *
 * Made by mars-area — https://github.com/mars-area
 */
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('./client.js', import.meta.url), 'utf8')
let definition
const calls = []

const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...props, children: children.length > 1 ? children : children[0] } }
  },
  useState(value) { return [value, () => {}] },
  useEffect() {},
}

function MenuItemButton() {}
function IconTrashOutlineRegular() {}

const requireStub = (name) => {
  calls.push(name)
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') {
    return { MenuItemButton, IconTrashOutlineRegular }
  }
  throw new Error(`unexpected require ${name}`)
}

const sandbox = { window: { __ModuleLoader__: { load(value) { definition = value } } } }
vm.runInNewContext(source, sandbox)

const checks = []
const check = (name, ok, extra) => {
  checks.push({ name, ok: Boolean(ok), extra })
  if (!ok) console.log('FAIL', name, extra ?? '')
}

check('registers under the package name', definition?.id === 'dsh-chat-trash', definition?.id)

const browser = definition.factory(requireStub)
check('requires react', calls.includes('react'), calls)
check('requires the shared primitives', calls.includes('@deepseek-ai/dsh-client-ui-primitives'), calls)

const registered = []
browser.apply({
  slots: {
    inject(slot, register) {
      check(`injects ${slot}`, slot === 'sidebar.workspaces.session.menu.item', slot)
      register()
    },
    register(options, Component) {
      registered.push({ options, Component })
      return () => {}
    },
  },
})

check('registers two rows', registered.length === 2, registered.length)
check('first row is Delete chat', registered[0]?.options.id === 'chat-trash-delete', registered[0]?.options)
check('second row is Empty trash', registered[1]?.options.id === 'chat-trash-empty', registered[1]?.options)
check('rows follow Copy Session ID (450)', registered[0]?.options.order > 450, registered[0]?.options.order)

const deleteOuter = registered[0]?.Component({ sessionId: 'session-1', displayTitle: 'Demo chat' })
const deleteRow = typeof deleteOuter?.type === 'function' ? deleteOuter.type(deleteOuter.props) : deleteOuter
check('delete row renders the primitive', deleteRow?.type === MenuItemButton, deleteRow?.type)
check('delete row label', deleteRow?.props?.children === 'Delete chat\u2026', deleteRow?.props?.children)
check('delete row carries the trash icon', deleteRow?.props?.icon?.type === IconTrashOutlineRegular, deleteRow?.props?.icon?.type)
check('delete row selects a handler', typeof deleteRow?.props?.onSelect === 'function', typeof deleteRow?.props?.onSelect)

const emptyRow = registered[1]?.Component({ sessionId: 'session-1', displayTitle: 'Demo chat' })
check('empty row renders nothing at zero', emptyRow === null, emptyRow)

const failed = checks.filter((entry) => !entry.ok)
console.log(JSON.stringify({ total: checks.length, failed: failed.length, failures: failed }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
