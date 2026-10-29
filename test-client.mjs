/**
 * Standalone check of the browser half: it evaluates client.js against a stub
 * module loader and asserts the row the Slots API receives.
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

check('registers one row', registered.length === 1, registered.length)
check('the row is Delete chat', registered[0]?.options.id === 'chat-trash-delete', registered[0]?.options)
check('the row follows Copy Session ID (450)', registered[0]?.options.order > 450, registered[0]?.options.order)

const outer = registered[0]?.Component({ sessionId: 'session-1', displayTitle: 'Demo chat' })
const row = typeof outer?.type === 'function' ? outer.type(outer.props) : outer
check('renders the primitive', row?.type === MenuItemButton, row?.type)
check('label', row?.props?.children === 'Delete chat\u2026', row?.props?.children)
check('carries the trash icon', row?.props?.icon?.type === IconTrashOutlineRegular, row?.props?.icon?.type)
check('selects a handler', typeof row?.props?.onSelect === 'function', typeof row?.props?.onSelect)

const failed = checks.filter((entry) => !entry.ok)
console.log(JSON.stringify({ total: checks.length, failed: failed.length, failures: failed }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
