# chat-trash — Delete chat for the DSH workspace sidebar

Built by **[mars-area](https://github.com/mars-area)**.

Adds two entries to a Session's `···` menu in the sidebar:

- **Delete chat…** — confirms, then archives the chat (so its row leaves the sidebar at once) and moves its stored log into `<DSH_HOME>/trash/chat-trash/<timestamp>-<session-id>/`.
- **Empty trash (n)** — appears once the trash holds something; permanently removes every trashed chat.

Both rows are drawn with `MenuItemButton` from `@deepseek-ai/dsh-client-ui-primitives`, the same primitive the shipped Pin, Rename, Fork and Archive rows use, and carry the app's `IconTrashOutlineRegular` trash icon — so their type, weight, padding, icon size and hover treatment match the rest of the menu rather than imitating it. `Empty trash` starts a new group with the same separator the shipped menu uses.

## Install

1. In the Harness Web UI open **Plugins** in the sidebar.
2. **Add plugin → Install a third-party plugin**.
3. Enter the repository URL:

   ```
   https://github.com/mars-area/dsh-chat-trash
   ```

   The short form `github:mars-area/dsh-chat-trash` works too.
4. Install, then switch the `chat-trash` bundle on if it is not on yet.
5. Open a chat's `···` menu in the sidebar: **Delete chat…** is the last row.

## What a delete does

1. Refuses when the chat is open in the interface (the host still holds its write handle) or while its turn runs — switch to another chat first.
2. Archives the Session through the workspace registry, which ends the open turn and removes the row from the sidebar.
3. Moves the session directory (`<DSH_HOME>/sessions/<workspace>/<session-id>/`) into the trash, writes a `trash.json` manifest beside it, and drops the projection-cache row.

Restoring one by hand: move the directory back to `<DSH_HOME>/sessions/<workspace>/<session-id>/`, then unarchive the chat from the sidebar's archived view.

## Limits

- DSH has no delete API by design, so this bundle moves files behind the persistence seam. A future Harness version may change the log layout or the `sidebar.workspaces.session.menu.item` contract; the plugin then fails loudly (the button reports the error) or stops appearing, and should be updated.
- Deleting only affects this machine. Logs already uploaded by *Settings → General → Upload Session Log when using the official model API* cannot be reached from here.
- Turning the bundle off in Plugins removes both menu rows; trashed chats stay in `<DSH_HOME>/trash/chat-trash/` until you delete that folder.

## Credit

Made by **[mars-area](https://github.com/mars-area)**. Issues, patches and ideas for the
menu styling belong there.

## Files

| File | Role |
|---|---|
| `index.js` | Host half: the delete/status/purge HTTP routes, archive-first delete, trash layout |
| `client.js` | Browser half: the two menu rows, their trash icon and confirmations |
| `icon.svg` | Bundle artwork shown on the Plugins page (256 px SVG) |
| `cordis.patch.yml` | Inserts the plugin row into the profile |
| `test-host.mjs` | Smoke test of the host half against a throwaway `DSH_HOME` (not shipped) |
| `test-client.mjs` | Smoke test of the browser half against a stub module loader (not shipped) |

Run both with any Node 22+:

```powershell
# browser half: factory, requires, slot registrations, row props
node test-client.mjs

# host half: archive-first delete, trash layout, refusals, purge
$env:DSH_HOME = "$env:TEMP\chat-trash-test\home"
$env:TEST_HOME = $env:DSH_HOME
$env:PLUGIN_INDEX = "$env:TEMP\chat-trash-test\index.mjs"
node test-host.mjs
```
