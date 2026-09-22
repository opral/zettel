# User-flow QA — 2026-09-21

Three independent GPT-5.6 Luna agents, extra-high reasoning, tested actual Chromium interactions against disposable native-Lix demo instances. Their scopes were editing, clipboard/formatting/history, and navigation/save/failure recovery. The main agent reproduced and repaired editor defects and reviewed integration. No QA test used the interactive demo's database.

The earlier browser suite imported Markdown before most edits and checked too few visible error states. It was insufficient evidence that ordinary authoring worked. This pass inspects visible `#error` messages, DOM and stored JSON, selections, IDs, target/author relationships, failure recovery, and browser errors.

## Reproduced defects and repairs

- Custom element nodes inherited Lexical's throwing `updateDOM` implementation. Nodes now implement DOM reconciliation, including metadata changes.
- Span DOM updates replaced text nodes on every keystroke. Updates now preserve the DOM text node when possible.
- Freshly typed text used generic TextNodes, producing new Zettel IDs on every export. The registry now creates ZettelSpanNodes for ordinary text insertion.
- Formatting a portion of a link lost annotations on newly split spans. Splits now retain shared annotation references.
- Deleting the contents of a code block resurrected its original source. Export now reads edited children, including the empty state.
- Enter in code blocks misplaced subsequent typing around terminal newlines. Enter now inserts Lexical line-break nodes instead of literal newlines in text nodes.

- Forward Delete was not handled, and undo/redo was not registered. Both now use Lexical commands/history; loading another document resets the undo baseline.
- Editing only the Markdown textarea did not protect the draft during navigation and could save stale rich text. Such drafts now prompt on navigation and must be imported before saving.
- A successful POST followed by a failed state refresh could create a duplicate on retry. The returned comment ID is now retained for subsequent updates.
- Clicking the active conversation discarded its draft; this is now a no-op.
- Save now locks author/Markdown controls as well as the editor, and pending saves protect against unloading.
- Disposable test servers collided because Vite treated port zero as its default port. They now receive independent OS-assigned ports.

## Reproducing browser checks

From the repository root, build first, then run:

```sh
pnpm build
pnpm --filter zettel-lix-comments test
```

Set `BROWSER_BIN` to a Chromium executable if Playwright's bundled browser is not installed. The demo suite requires the sibling Lix checkout described in the demo README. `test:qa` runs the three retained agent suites independently of the original model/browser tests. JSON results and screenshots go into the ignored `artifacts/` directory.

## Results

- Agent editing suite: 8/8 scenarios passed.
- Agent clipboard/formatting/history suite: 12/12 passed.
- Agent navigation/save/recovery suite: 12/12 passed.
- Additional code-caret regression passed: type after Enter, insert before the line break, and replace deleted code.
- Existing demo model suite: 6/6 checks passed; existing browser suite: 6/6 passed.
- Repository lint/build/package tests passed; additional code regression is included with the Lexical tests.
- No uncaught browser errors. Deliberately injected HTTP failures and missing-favicon noise are distinguished from unexpected errors.
- Restarted the interactive server and verified direct typing without saving a test comment.

## Scope

This is bounded Chromium user-flow testing, not exhaustive browser/IME/accessibility certification. Model-level database/merge checks remain separate from browser editing checks. The paragraph and CSV targets remain explicit test schemas rather than production file-plugin integrations.
