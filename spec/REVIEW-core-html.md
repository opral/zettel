# Zettel v1 core and HTML review

I reviewed `spec/v1.md`, `spec/compatibility.md`, and `spec/html-contract.md` against the current `@opral/zettel-ast` and `@opral/zettel-html` source. I ran the AST and HTML test suites, built both packages, and used direct `importHtml`/`toHtml` probes for malformed structures, shared links, linked images, lists, tables, whitespace, URL schemes, scripts, event attributes, and duplicate keys. The findings below are cases the existing tests did not cover.

## Findings

### P1 — static table export emits malformed HTML and loses the table header in a browser

`renderTable` appends `<thead>` immediately after the table's final attribute (`packages/zettel-html/src/html.ts:290`) without the required `>` that closes the opening `<table>` tag. The resulting HTML is, for example:

```html
<table class="zettel_table" data-zettel-key="t"<thead><tr>...</tr></thead></table>
```

`parse5` parses `<thead` as an attribute named `<thead`, then inserts the row into an implicit `<tbody>`; a browser therefore does not get the required semantic `<thead>`. The current round-trip test hides this because `parseTable` recursively finds `tr` descendants and reconstructs the row as a header regardless of the DOM's section. A static consumer querying `table > thead`, screen-reader table semantics, and CSS targeting the header all see the wrong structure.

Reproduction after `pnpm --filter @opral/zettel-html build`:

```js
import { toHtml } from "./packages/zettel-html/dist/html.js";
const doc = {$schema: "https://zettel.dev/schema/1/schema.json", blocks: [{
  type: "zettel_table", zettel_key: "t", align: [null], rows: [{
    type: "zettel_table_row", zettel_key: "r", cells: [{
      type: "zettel_table_cell", zettel_key: "c", children: [], markDefs: []
    }]
  }]
}]};
console.log(toHtml(doc));
// ... data-zettel-key="t"<thead> ...
```

Close the opening tag before emitting `thead`/`tbody`, and add a browser/parse5 structural assertion (`table > thead > tr`, `table > tbody > tr`) rather than only checking a round-trip AST.

### P1 — table imports silently discard unsupported spans and attributes

The fragment policy requires a diagnostic whenever a structure has no faithful Zettel representation. `parseTable` ignores `colspan` and `rowspan` on every cell and currently gives no diagnostic; it also normalizes the source to one cell per source element. For example:

```html
<table><tr><th>A</th></tr><tr><td colspan="2">B</td></tr></table>
```

becomes a one-column table with no indication that the source requested a two-column span. `rowspan` has the same problem. A rich paste caller cannot distinguish an intentional one-column table from a lossy conversion. Detect non-`1` `colspan`/`rowspan` (and any other table feature that cannot be represented) and emit a diagnostic; preserve the readable cell content or preserve the table as read-only HTML according to the chosen policy.

### P1 — HTML extension handlers can return an invalid document without validation

`importHtml` directly appends the value returned by `ExtensionHandler.fromHtml` (`html.ts:448-454` and `635-643`) and returns it as a `Document`; it never validates the returned node, checks its key against `context.usedKeys`, or checks that an inline handler returned an inline node and a block handler returned a block node. A handler returning `{type: "zettel_text", zettel_key: "same"}` from an inline location, or two extension nodes with the same key, produces a result that violates the core contract while `importHtml` reports no diagnostic. The same applies to missing fields and unresolved marks in a handler-produced core node.

This is an extension boundary, so the application handler is trusted to implement its payload semantics, but the package still owns the returned `Document` shape and global key invariant. Validate handler output using the registered extension/profile rules, register its keys through the same allocator, and report a diagnostic or reject the import when the handler returns a malformed/wrong-kind node. Add probes for malformed and duplicate-key handler results.

### P2 — exported `CoreBlock` is not recursively core-only

The public AST aliases call `CoreBlock` a core-only union, but its recursive fields use the extension-capable aliases: `TextBlock.children` is `Inline[]`, `ListItem.blocks` and `Quote.blocks` are `Block[]`, and table cells likewise accept `Inline[]`. TypeScript therefore accepts an application atom inside a value typed as `CoreBlock`, while `validateDocument` and the core JSON Schema reject that value without extension registrations. `Extension` also allows any `type: string`, so a reserved `zettel_*` object can be accepted through the extension arm at compile time even though runtime validation rejects it.

For example, this compiles against `@opral/zettel-ast`:

```ts
const core: CoreBlock = {
  type: "zettel_text", zettel_key: "p", style: "normal", markDefs: [],
  children: [{ type: "app_mention", zettel_key: "m", account: "u1" }],
};
```

Define recursive core-only child aliases (and exclude the reserved namespace from extension types), or avoid exporting a misleading `CoreBlock` name. Add a type fixture alongside runtime/schema agreement checks.

### P2 — unsupported form controls are silently dropped without a diagnostic

`parseInlineNodes` drops every checkbox (`html.ts:412-414`) and otherwise drops all `<input>` elements by falling through the empty `INLINE_TAGS` branch. Checkboxes directly in list items are supported task state, but controls nested in a paragraph or controls such as `<input type="text">` are active/unsupported content with no faithful core representation. For example, `importHtml('<p>before<input type="text" value="secret">after</p>')` returns only `before` and `after`, with no diagnostic or read-only source. The clipboard contract calls for diagnostics where active content is dropped. Emit a diagnostic for unsupported controls (while retaining list checkbox state), or preserve a safe read-only representation when its text/source is meaningful.

## Probes that passed

The current implementation correctly rejects malformed ASTs before export, enforces duplicate/unresolved marks and document-wide keys in runtime validation, preserves a shared link key across differently formatted contiguous runs, preserves links around images, escapes raw HTML, drops scripts/styles/event attributes, rejects unsafe default URL schemes, allocates fresh keys for imported fragments, and preserves soft LF versus explicit `br` in HTML fragments. Existing test coverage did not expose the malformed table opening tag because the importer reconstructs table sections from rows.

## Validation and limits

- `pnpm --filter @opral/zettel-ast test` passed (9 tests).
- `pnpm --filter @opral/zettel-html test` passed (7 tests), and both packages built successfully.
- Direct probes used parse5 plus the built package. The table output probe inspected the parsed tree and showed `attrs: [{name: "<thead", value: ""}]` with an implicit `tbody`.
- Root is independently addressing short/nonrectangular table rows, nested list normalization, ordered-list bounds, and nested task-checkbox parsing; those cases are omitted as resolved implementation work rather than reported as residual findings here.

## Resolution check

The reported issues were fixed in the current tree:

- Table export now closes the opening tag before `thead`/`tbody`; a parse5 structural regression checks for a real `table > thead > tr`.
- Table import reports `unsupported-table-span` for non-unit `rowspan`/`colspan` while retaining readable cell content.
- HTML extension results are validated against the registered profile, checked for document-key collisions, and replaced with inert read-only HTML when malformed. A final document assertion rejects any remaining importer invariant failure; no invalid Document is returned.
- Unsupported form controls now produce `dropped-control`; list task checkboxes remain handled as task state without duplicate diagnostics.
- `CoreBlock` now has recursive core-only variants for text, lists, quotes, and tables; `Block` remains the extension-capable union used by `Document`. Type fixtures cover inline and nested extension rejection.
- `@opral/zettel-html` marks CSS files as side effects and publishes a typed conditional root export.

Follow-up validation: AST tests pass (10 tests), HTML tests pass (13 tests), both packages build, and the Markdown package builds against the recursive type changes. The full workspace build remains blocked by unrelated concurrent Lexical errors in `src/plugin.ts` (`BaseSelection.anchor` and an unused `siblings` local).

Root integration follow-up: added a regression for supplied annotation keys with different destinations and decorator-name collisions. Import now allocates distinct definitions instead of changing a later link's target. HTML tests pass (14). The final importer boundary asserts the document's validity rather than returning invalid data alongside a diagnostic.

A separate read-only follow-up reviewed the public Lexical state conversion and package exports. It found that an extension payload's `marks` property was incorrectly being used to infer inline placement; this was handed to the Lexical reviewer for a structural-context-only fix. Package tarball dry runs also exposed shipped test files; the package file allowlists now exclude those files.

Final integrated follow-up: clean workspace build, all 61 package tests, and all 16 Chromium scenarios pass. The extension-placement fix is covered by the Lexical regression suite.
