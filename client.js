/**
 * Browser half of the chat-trash bundle.
 *
 * Adds one row, "Delete chat…", to the Session row menu of the workspace
 * sidebar. It calls the host route the other half registers and reloads the
 * page, because the deleted chat must not stay on screen.
 *
 * The row renders through the workspace bundle's own `MenuItemButton` from
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

    function Row({ label, onSelect }) {
      if (MenuItemButton !== undefined) {
        return h(
          MenuItemButton,
          {
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
      const response = await fetch(base + path, {
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
            + 'The chat leaves the sidebar and its history is deleted from this machine. '
            + 'This cannot be undone.',
          )
          if (!agreed) return
          try {
            await call('/delete', { sessionId })
          } catch (error) {
            window.alert(`Could not delete this chat: ${error.message}`)
            return
          }
          // The log is gone; reload so the conversation pane cannot keep showing
          // a chat that no longer exists.
          window.location.reload()
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
      },
    }
  },
})
