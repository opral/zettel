# Implementation verification

This report covers the breaking Zettel implementation on `dev/portable-text-profile`, not the earlier Lix commenting prototype. The four packages share one document contract. Legacy APIs and migration layers are removed.

## Verification strategy

- AST: JSON Schema and runtime checks for keys, annotations, recursive extensions, non-JSON values, and invalid table structure.
- Markdown: pinned upstream `github/cmark-gfm` examples, semantic import/export checks, and expected upstream HTML checks through micromark’s renderer. Fixture source and license are recorded in [fixtures](../fixtures/gfm/README.md).
- HTML: semantic output, rich fragment import, diagnostics, URL policy, and malformed or unsupported clipboard content.
- Lexical: direct model round trips plus editing, selection, clipboard, key remapping, and unknown-content behavior.
- Browser: the actual playground in Chromium, comparing editable/static content styling and exercising user actions. CI runs these checks after the package tests.

## Executed results

Verified locally on 2026-09-21 with Node 22.23.2 and pnpm 10.23.0.

| Check | Result |
| --- | --- |
| Frozen dependency installation | Pass |
| Clean workspace TypeScript build and schema generation | All four packages pass |
| AST tests | 10 pass |
| Markdown tests | 16 pass, including all 672 pinned upstream examples in the semantic round-trip loop |
| HTML tests | 14 pass |
| Lexical tests | 21 pass |
| Playground production build | Pass |
| Chromium playground | 16 scenarios pass; no page errors |
| Package archive dry runs | All four entry points present; bundled schema/CSS present; test and old v1 files excluded |
| Git whitespace check | Pass |

Commands: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test`, `pnpm --filter zettel-playground build`, and `BROWSER_BIN=/root/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome pnpm --filter zettel-playground test`. The browser runner also supports Playwright's installed Chromium without `BROWSER_BIN`.

The 16 browser scenarios cover matching shared styles, typing with stable identities, paragraph/list/code Enter behavior, hard breaks, table editing and actual static header structure, shared/decorated links, formatting, rich paste diagnostics, multi-paragraph paste, selected copy and remapped paste, invalid schema rejection, and a 390px layout. Screenshots and result JSON are generated under ignored `examples/playground/artifacts/`.

The 672-example check compares semantic document round trips; it is not a claim of byte-identical Markdown or HTML output. Representative GFM features are also compared against the upstream expected HTML. Micromark underlies remark, so it is a separate rendering path, not an independent parser implementation. The independent review examined full-corpus rendered differences and documented upstream parser/version differences and accepted mark canonicalization.

## Independent reviews

GPT-5.6 Luna agents at extra-high reasoning reviewed the implementations and reproduced edge cases. Findings and resolutions are recorded in [core/HTML review](REVIEW-core-html.md), [Markdown review](REVIEW-markdown.md), and [Lexical review](REVIEW-lexical.md). These were implementation reviews, not blind preference experiments.

Fixed findings include malformed table markup, lossy table/checkbox imports, invalid extension handler output, a fixture extraction bug, reference precedence, escaped email/entity conversion, multi-block paste loss, incorrect container editing, duplicate serialized children, duplicate annotation keys after splits, and opaque-extension placement/payload changes.

The editor table DOM currently places rows directly under the table, while static output uses header/body sections. Partial copying inside nested lists preserves selected text and marks as text blocks rather than reconstructing the enclosing list. These remaining editor limitations do not change the document format and are described in the Lexical review.

`pnpm lint` has no package lint tasks and is not counted as verification. The playground bundle includes all converters and emits Vite's bundle-size advisory; it is a development showcase, not a production bundle-size target.

## Scope

The schema is bundled and served locally by the playground; this change does not deploy its public URL or publish npm packages. Raw HTML is preserved as source and rendered inert. Arbitrary HTML layout is not a supported import contract. Markdown canonicalization does not preserve original source spelling or Zettel keys.

This implementation does not add Lix schemas, structural merging, comment targets, mentions, attachments, reactions, ZIP packaging, or Tiptap bindings. The playground is local and does not persist a database. The Lexical package supplies editing bindings; application toolbars and a complete document-authoring product remain application concerns.
