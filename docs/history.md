# Conversation display history

With **Auto-Scroll to latest message on chat open** enabled, the chat requests the newest
24 messages. Scroll upward near the beginning of the loaded messages, or select **Load older
messages**, to request another page. Loading preserves the visible message and its viewport
offset. Failed pages keep the current history and offer a retry.

Set `interface.historyWindowSize` in `librechat.yaml` to change the page size (1–100).
Set it to `0` to load the full history. The existing user preference defaults to disabled;
with it disabled, the chat loads the full history and starts at the beginning. Explicit
message targets also load the full tree so the target and its branch are available.

History file cards contain metadata. Opening a preview fetches its body through the existing
authorized file preview endpoint, with a message-scoped reader for embedded historical
snapshots. Closing and reopening reuses the cached body. Pending file previews poll only
after opening, using the existing file-preview polling policy. Images and file
downloads keep their existing paths. The legacy log renderer supports the same lazy cards.

The display reader excludes attachment and uploaded-file text in MongoDB. Cursor pages use
the existing `(conversationId, user, createdAt, _id)` index, fetching at most one extra row to
detect the next page. Equal timestamps use the stored insertion position as a tie breaker.
Each read validates conversation access and explicitly scopes its database query to the user
and tenant. Cursors are positions, never access grants.

The shared message cache remains the owner of displayed and streamed messages. A separate
query records the loaded boundary; warm navigation and stream reconciliation revalidate the
loaded span, including new replies and deletions. They do not fetch the older remainder.
Prepending preserves current live objects and the selected branch, including when the window
started in the middle of a tree. Regenerate can read one missing parent on request. History
retention releases pagination state and opened attachment bodies with the conversation.

Model context, stored messages, full exports, and shared snapshots retain their full history
and file content. Screenshot export explicitly loads the full display history before capture.
Old clients that omit the display parameters still receive the full array with bodies. A new
client accepts an old server's full-array response during a rolling upgrade.

The Lighthouse lane includes a synthetic conversation with 541 messages, 405 attachments,
and over 12 MB of attachment text. Its browser check covers bounded initial retrieval, no
background body loads, explicit preview, complete text copy and download, cached reopening,
upward paging with an anchor, full legacy history, and the disabled preference. It writes `payload.json` in the
Playwright result directory. These are local fixture measurements, not production benchmarks.
