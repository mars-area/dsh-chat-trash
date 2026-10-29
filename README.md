# chat-trash

> Permanently delete a chat from the DeepSeek Harness sidebar — no archive copy left behind.

Built by **[mars-area](https://github.com/mars-area)**.

One entry appears in a Session's `···` menu in the sidebar:

- **Delete chat…** — confirms, then removes the chat: its running turn is stopped, its workspace membership, pin and archive marks are cleared, and its stored log and projection cache are deleted. The page reloads; the chat is gone from every view, not moved to the archive and not kept in a trash folder.

The row is drawn with `MenuItemButton` from `@deepseek-ai/dsh-client-ui-primitives`, the same primitive the shipped Pin, Rename, Fork and Archive rows use, and carries the app's `IconTrashOutlineRegular` trash icon — so its type, weight, padding, icon size and hover treatment match the rest of the menu rather than imitating it.

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

To work on the plugin, install your local checkout instead by entering its absolute
path (`C:\Users\<user>\projects\dsh-chat-trash`); toggle the bundle off and on
after editing `client.js` or `index.js`.

## What a delete does

1. Stops any running turn, job, subagent or scheduled reminder of that chat.
2. Takes the live Session out of the session store, so the sidebar stops listing it at once and persistence drains its last events and closes the log handle. Without this step a chat deleted only on disk lingered under *Ungrouped* until the next launch.
3. Clears the chat's pin, its workspace membership and any archive mark, so no row or archived copy survives anywhere.
4. Deletes `<DSH_HOME>/sessions/<workspace>/<session-id>/` and its `<DSH_HOME>/storages/session_projcache` row.
5. Reloads the page, so the conversation pane cannot keep showing a chat whose log no longer exists.

An open but idle chat is deletable. DSH keeps every chat you have opened live in memory for the run, so "is this chat open?" is not a usable test — the plugin does not make it.

## There is no undo

The log is deleted, not archived, so keep a copy first when it matters: use the
Session header's **Download session log** action or the `/export` command, which
writes a ZIP of the session, its sub-sessions and attachments.

## Limits

- DSH has no delete API by design, so this bundle edits the persistence directory behind the seam. A future Harness version may change the log layout or the `sidebar.workspaces.session.menu.item` contract; the plugin then fails loudly (the button reports the error) or stops appearing, and should be updated.
- Deleting only affects this machine. Logs already uploaded by *Settings → General → Upload Session Log when using the official model API* cannot be reached from here.
- Turning the bundle off in Plugins removes the menu row; chats already deleted stay deleted.

## Credit

Made by **[mars-area](https://github.com/mars-area)**. Issues and patches belong there.

## Files

| File | Role |
|---|---|
| `index.js` | Host half: the delete route, work stop, membership cleanup, file removal |
| `client.js` | Browser half: the menu row, its icon and confirmation |
| `icon.png` | Bundle artwork shown on the Plugins page (256×256 PNG) |
| `cordis.patch.yml` | Inserts the plugin row into the profile |
| `test-host.mjs` | Smoke test of the host half against a throwaway `DSH_HOME` (not shipped) |
| `test-client.mjs` | Smoke test of the browser half against a stub module loader (not shipped) |

Run both with any Node 22+:

```powershell
# browser half: factory, requires, slot registration, row props
node test-client.mjs

# host half: stop, detach, delete, refusals
$env:DSH_HOME = "$env:TEMP\chat-trash-test\home"
$env:TEST_HOME = $env:DSH_HOME
$env:PLUGIN_INDEX = "$env:TEMP\chat-trash-test\index.mjs"
node test-host.mjs
```
