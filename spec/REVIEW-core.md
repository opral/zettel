# Zettel v1 core review

Reviewed the candidate specification, generated TypeBox schema, `/v1` runtime validator and types, and the Lix comments profile. I ran adversarial probes against the built `@opral/zettel-ast/v1` output and the Markdown profile. The core and Markdown tests pass after a build; the review below records contract issues that the current tests do not cover.

## Findings

### P1 — extension callbacks can mutate a document even though validation promises no mutation

`spec/v1.md` says validation MUST NOT mutate its input, and `validateDocument` repeats that promise in its JSDoc. `validateExtension` invokes the registered callback with the original node (`packages/zettel-ast/src/v1/validate.ts`, around line 208), rather than an immutable or isolated value. A callback that is accidentally impure can change persisted content while validation reports success. It can also change `_key` or `_type` after the validator has already registered the original key/type, so the final value may no longer satisfy the invariants that were checked.

Reproduction from `packages/zettel-ast`:

```js
import { validateDocument } from "./dist/v1/index.js";

const body = {
  format: "zettel",
  version: 1,
  blocks: [{ _type: "app_card", _key: "card", value: "before" }],
};
const before = JSON.stringify(body);
const result = validateDocument(body, {
  blocks: { app_card: (node) => { node.value = "after"; return []; } },
});

// result.ok === true
// before contains "before", but JSON.stringify(body) contains "after"
```

This is an extension-boundary bug, not a claim that the core traversal itself mutates. Either validate a detached JSON clone, freeze the callback view (with a documented callback restriction), or change the public contract to say callbacks must be pure and treat that as an explicit trust boundary. Whatever choice is made, test a callback that changes `_key` as well as payload data.

### P1 — the exported “core” TypeScript types accept extension nodes rejected by the core schema and validator

`CoreDocument` is described as the core-only shape, but `TextBlock.children` is `Inline[]`, and `Inline` includes `ExtensionInline`. `ZettelListItem.blocks` and `ZettelQuote.blocks` similarly use `Block[]`, where `Block` includes `ExtensionBlock`. Consequently a value typed as `CoreDocument` can contain an application inline atom or block atom without any type error, while `documentSchema` and `validateDocument(value)` reject the same value unless extension callbacks are supplied.

For example, this is accepted by the declarations:

```ts
const core: CoreDocument = {
  format: "zettel",
  version: 1,
  blocks: [{
    _type: "block", _key: "p", style: "normal", markDefs: [],
    children: [{ _type: "app_mention", _key: "m", accountId: "u1" }],
  }],
};
```

The same mismatch exists for an `app_card` inside a quote or list item. Keep the extension-capable `Document` type separate from a genuinely core-only recursive type (for example, a core text block whose children are `Span[]` and core containers whose descendants are core blocks), or rename the current aliases so callers do not infer core-only guarantees. Add compile-time and runtime/schema agreement tests for root and nested extension positions.

### P1 — non-check list item types expose `checked`, although runtime validation rejects it

`ZettelListItem.checked` is optional, and both `BulletList.items` and `NumberList.items` are `ZettelListItem[]`. The TypeScript API therefore accepts a bullet or numbered item with `checked: true` or `checked: false`. The runtime validator correctly rejects that field for those list kinds, and the JSON schema omits it. This allows code written against the exported types to construct a value that fails validation.

The relevant declarations are `packages/zettel-ast/src/v1/schema.ts` lines 173–193. A discriminated item type should make `checked` present only for checklist items; the common item shape can omit it, with a checklist-specific intersection as already used for `CheckList.items`. Preserve the runtime rejection and add a type-level fixture so this cannot regress.

### P2 — arbitrary JavaScript objects can pass validation and then lose data when serialized as JSON

The format is JSON, but the runtime accepts plain objects based on property lookup and checks own keys only for allowed names. It does not require required fields to be own enumerable JSON properties. A document assembled with non-enumerable fields passes, but serializes to `{}`:

```js
import { validateDocument } from "./dist/v1/index.js";

const hidden = (object, key, value) =>
  Object.defineProperty(object, key, { value, enumerable: false });
const span = {};
for (const [key, value] of [["_type", "span"], ["_key", "s"], ["text", "x"], ["marks", []]])
  hidden(span, key, value);
const block = {};
for (const [key, value] of [["_type", "block"], ["_key", "b"], ["style", "normal"], ["markDefs", []], ["children", [span]]])
  hidden(block, key, value);
const document = {};
for (const [key, value] of [["format", "zettel"], ["version", 1], ["blocks", [block]])
  hidden(document, key, value);

validateDocument(document).ok; // true
JSON.stringify(document);       // "{}"
```

Parsed JSON cannot contain this shape, so this is lower priority for callers that always begin with `JSON.parse`. The validator accepts `unknown`, however, and promises a JSON data contract and no silent loss. Either reject non-enumerable/accessor/non-JSON object shapes (including extra array properties) or document that only JSON-parsed values are in scope and test that boundary explicitly. The same issue can affect extension payloads; the profile callbacks use `Object.keys`, so hidden extension fields are also invisible to the Lix shape checks.

## Deliberate draft limitations, not findings

- The core JSON Schema does not include application atoms; it is intentionally a core schema, while registered extensions are checked only by `validateDocument` callbacks.
- Runtime-only checks for global key uniqueness, block-local mark references, decorator/key collisions, and conditional list fields are expected because ordinary JSON Schema shape does not express all of those invariants.
- There is no automatic migration, editor binding, merge implementation, or FK/existence check for Lix RowRefs/file IDs. The specification and profile explicitly describe those as application boundaries.
- Empty quotes, empty paragraphs, empty code, and unused link definitions are explicitly allowed by v1 even where the Markdown adapter rejects them as lossy export cases.

## Validation performed and limits

- `pnpm --filter @opral/zettel-ast build` passed.
- `pnpm build && pnpm test` passed: AST tests 25 passed (one skipped), HTML tests 17 passed, and the legacy Lexical suite was entirely skipped/todo.
- `node --test examples/lix-comments/src/markdown.test.js` passed all 14 tests.
- Before building the workspace, direct `pnpm test` failed to resolve the legacy `@opral/zettel-html` package entry from the Lexical test; the repository's normal build-before-test flow removes that environment issue.
- I did not review or modify legacy adapter behavior, and did not treat the draft's deliberate unsupported Markdown cases as core-format defects.

## Resolution check after the follow-up fixes

The four original findings are resolved in the current tree:

- Extension callbacks now receive `structuredClone(value)`. A callback that changes `_key`, `_type`, or nested payload data leaves the source document byte-for-byte unchanged in the probe.
- `CoreBlock` is now recursively core-only, including span children and quote/list descendants. The `@ts-expect-error` fixtures for inline and nested extension atoms compile as expected, while extension-capable `Document` remains available.
- `ZettelListItem` no longer carries `checked`; bullet and numbered items use `checked?: never`, and the compile-time fixtures reject boolean checklist state. The JSON schema/runtime rejection remains intact.
- The JSON preflight rejects hidden properties, accessors, sparse arrays, extra array properties, cycles, and non-JSON values before traversal. The previous non-enumerable serialization-loss probe now returns `ok: false` without invoking the getter.

The residual prototype-pollution blocker is now fixed. The validator requires own properties for envelope fields, `_type` dispatch, and all required core arrays/`checked` fields before reading them. With a polluted prototype, this now fails and cannot be serialized as a valid body:

```js
Object.assign(Object.prototype, { format: "zettel", version: 1, blocks: [] });
const value = {};
validateDocument(value).ok; // false
JSON.stringify(value);       // "{}"
```

The regression covers inherited envelope fields, nested required arrays, checklist `checked`, and inherited `_type` dispatch, with prototype descriptors restored in `finally`. `TypeCompiler.Compile(documentSchema)` and runtime validation now agree for ordinary JSON data; the schema's treatment of non-JSON JavaScript descriptors remains outside JSON Schema's input domain.

The AST checks pass after the fix: 29 passed with one legacy skipped test. The full workspace checks also pass after a build (HTML 17 passed and the Lexical suite was 9 skipped/todo); the Lix Markdown profile is green at 16/16 tests.
