# Lix comments prototype

A throwaway app for the current Zettel document format. It uses the actual native Lix SDK, registered tables, row references, JSONB storage, foreign keys, checkpoints, branches, merges, and snapshot restore. It does not simulate a database or use a custom body merger.

## Run

Requires Node 22+, pnpm, and the sibling `lix` checkout with a built native JS SDK (`../lix/packages/js-sdk/dist/index.js` and its native binding, relative to the Zettel repository). From the Zettel repository root:

```sh
pnpm install
pnpm build
pnpm --filter zettel-lix-comments dev
```

Open `http://localhost:49705`. `PORT` overrides the default. The server binds to loopback. Data is saved atomically as a Lix snapshot at `examples/lix-comments/.data/comments-v2.lix`; startup restores it. This uses a new path and leaves the earlier prototype's database untouched. Run only one server against a snapshot path.

Choose a conversation, type in the Lexical editor, and save. Expand **Markdown and stored JSON** to import/export GFM or inspect the document. Use **Edit** on a saved comment to retain its row ID. The author picker is a demo fixture, not authentication. No mentions, reactions, or attachments are included.

## Tables

- `demo_conversation(id, target, title)` — `target` stores the opaque string returned by `lix_row_ref`, addressing a commit or a row in either test content table. It is an address, not a foreign-key constraint.
- `demo_comment(id, conversation_id, author_id, body JSONB, created_at)` — ordinary database-enforced FKs to conversation and account. Only `body` changes during editing.
- `demo_account(id, name)` — branch-local fixture accounts. This deliberately avoids the older prototype's global-account/branch-local-FK workaround and makes real branch merge tests possible. Connecting to the product's account model remains integration work.
- `demo_markdown_paragraph(id, file_path, position, text)` and `demo_csv_row(id, file_path, position, data JSONB)` — test projection schemas with stable row IDs. They represent a paragraph and CSV row; they do **not** parse or synchronize actual Markdown/CSV files. `file_path` is fixture context. File-plugin identity behavior is not tested here.

The checkpoint target is an actual `lix_commit`. Paragraph/CSV addresses stay unchanged when text/data and ordering change while the primary key remains stable. Deletion/retargeting policy remains out of scope.

Bodies use `{ "_type": "zettel_doc", "blocks": [...] }`, `_type`/`_key` on content nodes, and shared `markDefs`. Application validation runs before comment writes. The JSONB column itself does not enforce the Zettel schema. Server requests are serialized so snapshot writes and branch state cannot overlap inside this single-process demo. This is not a multi-process storage server.

## Tests

```sh
pnpm --filter zettel-lix-comments test
# If Playwright's pinned browser is not installed:
BROWSER_BIN=/path/to/chromium pnpm --filter zettel-lix-comments test
```

The tests use disposable databases, never the interactive demo's snapshot. The model test checks real FKs, body validation, target identity after edits/reordering, persistence across close/reopen, divergent branch merges, and merged-state persistence. The browser test imports GFM, types in Lexical, saves and reloads, edits each comment, exports Markdown, restarts the full server, and checks mobile overflow and console errors.

Results and screenshots are written to ignored `artifacts/`. See [VERIFICATION.md](VERIFICATION.md) for this run's observations.

The extended user-flow suites also exercise formatting, selection replacement, clipboard, undo/redo, code-block carets, unsaved drafts, and failed-save recovery. See [QA.md](./QA.md) for findings and scope. Run only those suites with `pnpm --filter zettel-lix-comments test:qa`.

Select prose text and choose **Link** (or Ctrl/⌘ K) to add a URL. Place the caret in an existing link to edit or remove it. Supports HTTP(S) and mailto links; formatting, Markdown export, and saved JSON retain link annotations.
