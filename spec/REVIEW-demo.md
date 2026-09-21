# Zettel × Lix comments demo review

Review date: 2026-09-21

Scope: the throwaway `examples/lix-comments` renderer, Markdown importer/exporter, shared demo profile validator, and the documented API/storage claims. The review treats the app as a local single-account demonstration; it does not require production authentication, notifications, collaboration, or legacy editor bindings.

## Findings

### Medium — Markdown import changes code line endings

`src/markdown.js:20` normalizes every CRLF/CR in the complete Markdown source before parsing. That also changes `code.code`, although the v1 contract says code strings remain literal, including their line endings (`spec/v1.md:52`). The converter advertises fenced code support (`spec/v1.md:107`), so this is a silent loss in a supported construct.

Reproduction from `examples/lix-comments`:

```sh
node --input-type=module <<'NODE'
import {fromMarkdown} from './src/markdown.js';
const source = '```text\\r\\nline1\\rline2\\r\\n\\r\\n```\\r\\n';
const body = fromMarkdown(source);
console.log(JSON.stringify(body.blocks[0].code));
NODE
```

Observed: `"line1\\nline2\\n"`. The code payload should retain `"line1\\rline2\\r\\n"` if code line endings are literal. Normalize prose line endings at the AST boundary, or otherwise preserve code content separately; add an import test covering CRLF and CR inside a fenced block.

### Medium — Strict import accepts Markdown that cannot be exported

The importer accepts empty ordinary links, empty file-attachment captions, and empty headings as valid v1 documents. The resulting documents are accepted by `validateBody`, but `toMarkdown` rejects them later (`empty paragraph`, `unused link definitions`, or `File attachment needs a caption`). This leaves a posted comment that the app can display and store but cannot export through its own strict Markdown action. The v1 spec requires an explicit diagnostic for lossy/unsupported conversion, including empty paragraphs and missing attachment display text (`spec/v1.md:109`).

Reproductions:

```sh
node --input-type=module <<'NODE'
import {fromMarkdown, toMarkdown} from './src/markdown.js';
for (const source of [
  '[](https://example.com)\\n',
  '[](lix://file/01950000-0000-7000-8000-000000000001)\\n',
  '#\\n',
]) {
  const body = fromMarkdown(source);
  console.log(JSON.stringify(source), 'imported', body.blocks[0]);
  try { toMarkdown(body); console.log('exported'); }
  catch (error) { console.log('export error:', error.message); }
}
NODE
```

Observed: import succeeds in all three cases, while export fails. Reject these cases in `fromMarkdown` with a source diagnostic, or explicitly define import as permissive and surface the non-exportable state in the UI before posting. Empty image alt text is a separate, intentional accessibility value and currently round-trips; the file-caption case is the missing-display-text failure.

### Low — `/api/validate` turns JSON `null` into an internal error

In `server.mjs:161-165`, the route evaluates `value.body` without guarding `value`. A syntactically valid request body of JSON `null` therefore throws a `TypeError` and returns the generic HTTP 500 response instead of the endpoint's normal validation result or a 400 malformed-input response. This is an API edge case, but it is easy to reproduce without any Lix data:

```sh
curl -i -X POST http://127.0.0.1:4174/api/validate \
  -H 'content-type: application/json' --data 'null'
```

Use an optional/object guard before reading `.body`, and add a route test for `null`, arrays, and primitive JSON values. This does not affect comment POST validation, which already uses optional access.

## Review limits and pending evidence

- Markdown unit coverage passed: `src/markdown.test.js` — 14 tests.
- Core v1 validation tests passed: 25 tests (one existing skip). This review did not re-audit core validator/type/schema behavior.
- `pnpm test:demo` reached all 14 Markdown tests, then the real-Lix server test failed during startup with `LIX_ERROR_INVALID_STORAGE_SCOPE` before state, JSONB, attachment, snapshot, or API assertions ran. The backend author is changing the seed/account-FK/origin setup; those claims remain pending and should be rerun after that change.
- Browser tests were not treated as evidence until the server seed path is repaired; root owns the rerun and browser checks.
- Static review found the renderer uses text nodes for user content, allow-lists rendered link protocols, preserves the JSON inspector payload, and shows placeholders for unsupported stored blocks. No additional renderer loss was demonstrated within the documented profile.

## Resolution recheck — 2026-09-21

- The code-line-ending finding is resolved. `fromMarkdown` now parses the original source, normalizes CRLF/CR only while creating prose spans, and keeps code block values literal. The new test `preserves literal CRLF and CR inside code while normalizing prose` passes.
- The strict-import finding is resolved for empty links and file captions: `fromMarkdown` now diagnoses both. Empty headings remain valid v1 blocks and `toMarkdown` now round-trips them, so they are no longer an import/export failure. The new test `rejects empty links and file captions; preserves an empty heading` passes.
- The `/api/validate` null-input finding is resolved. The route uses guarded body access, and the integration test checks `null`, arrays, primitives, and `{body:null}` return structured HTTP 200 validation failures rather than 500 errors. A manual cross-origin mutation check also returned 403 while same-origin and no-origin validation returned structured 200 responses.
- `pnpm test:demo` passes: 16 Markdown tests and the real-Lix integration test. The integration test verifies registered schemas and ordinary FKs, structured JSONB bodies, checkpoint RowRefs, distinct conversation mention RowRefs, file byte round-trip, snapshot reopen, and invalid-body rejection.
- The checked browser artifact reports all 8 checks passing with no page errors: seeded rendering, nested Markdown, JSON identity editing, upload/download, mentions, snapshot download, unsupported-document read-only retention, and mobile overflow. I could not rerun Chromium in this environment because the Playwright executable is absent; the artifact was produced by the requested browser test after the server fix.

The remaining backend limitation is intentional prototype scope: conversation and comment rows are registered with ordinary FKs but stored on Lix's global branch so the pinned engine can resolve the global `lix_account` parent; files and the checkpoint remain on main. I independently switched a fresh demo to a draft branch: it initially saw 3 comments, a draft-branch create raised that branch's view to 4, and switching back to main also showed 4. Thus comment writes are global and do not provide branch-local or merge semantics. README/PROFILE now state this explicitly, and it is acceptable for the requested single-account throwaway app. It becomes a blocker only if the demo later claims branch isolation, production conversation versioning, or collaboration.
