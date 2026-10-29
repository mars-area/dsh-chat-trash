/**
 * Browser half of the chat-trash bundle.
 *
 * Adds two rows to the Session row menu of the workspace sidebar:
 * "Delete chat…" for the row it was opened on, and "Empty trash (n)" once the
 * local trash holds something. Both call the host routes the other half of this
 * bundle registers.
 *
 * Rows render through the workspace bundle's own `MenuItemButton` from
 * `@deepseek-ai/dsh-client-ui-primitives`, the same primitive the shipped Pin,
 * Rename, Fork and Archive rows use, so typography, padding and the icon seat
 * match them exactly. If that module ever leaves the shared table, a plain
 * button with inherited font keeps the feature usable.
 *
 * Made by mars-area — https://github.com/mars-area
 */
window.__ModuleLoader__.load({
  id: 'dsh-chat-trash',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    let primitives
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      primitives = undefined
    }
    const MenuItemButton = primitives?.MenuItemButton
    const IconTrash = primitives?.IconTrashOutlineRegular

    const base = '/local-chat-trash'

    function Row({ label, onSelect, separatorBefore }) {
      if (MenuItemButton !== undefined) {
        return h(
          MenuItemButton,
          {
            separatorBefore,
            icon: IconTrash === undefined ? undefined : h(IconTrash, { size: 14 }),
            onSelect,
          },
          label,
        )
      }
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          style: {
            display: 'block',
            width: '100%',
            padding: '6px 10px',
            border: 'none',
            borderRadius: '6px',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          },
          onClick: onSelect,
        },
        label,
      )
    }

    async function call(path, body) {
      const response = await fetch(base + path, body === undefined
        ? { method: 'GET' }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
      const value = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status}).`)
      return value
    }

    function DeleteChat({ sessionId, displayTitle }) {
      const title = displayTitle || sessionId
      return h(Row, {
        label: 'Delete chat\u2026',
        onSelect: async () => {
          const agreed = window.confirm(
            `Delete \u201c${title}\u201d?\n\n`
            + 'It moves to the local trash and leaves the sidebar. '
            + 'Empty the trash from this menu when you want it gone for good.',
          )
          if (!agreed) return
          try {
            await call('/delete', { sessionId })
          } catch (error) {
            window.alert(`Could not delete this chat: ${error.message}`)
          }
        },
      })
    }

    function EmptyTrash() {
      const [count, setCount] = React.useState(0)

      React.useEffect(() => {
        let alive = true
        call('/status')
          .then((value) => { if (alive) setCount(value.count ?? 0) })
          .catch(() => {})
        return () => { alive = false }
      }, [])

      if (count === 0) return null

      return h(Row, {
        label: `Empty trash (${count})`,
        separatorBefore: true,
        onSelect: async () => {
          const agreed = window.confirm(
            `Permanently delete ${count} trashed chat${count === 1 ? '' : 's'}?\n\nThis cannot be undone.`,
          )
          if (!agreed) return
          try {
            await call('/purge', {})
            setCount(0)
          } catch (error) {
            window.alert(`Could not empty the trash: ${error.message}`)
          }
        },
      })
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'chat-trash-delete', order: 470 },
          DeleteChat,
        ))
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'chat-trash-empty', order: 480 },
          EmptyTrash,
        ))
      },
    }
  },
})
