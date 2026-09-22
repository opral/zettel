# Lexical binding adversarial review

I reviewed spec/IMPLEMENTATION-CONTRACT.md, spec/html-contract.md,
spec/compatibility.md, the package README, the Lexical source, and the
playground. I ran the package build and tests, the existing Chromium
scenarios, and the review.lexical.test.ts regression probes. The package
suite currently passes 21 tests; the browser suite had no page errors.

## Fixed during this review

- Return in a list item now creates a sibling list item, while Return in a
  quote splits the containing text block in its quote. Return in a table cell
  creates an explicit zettel_break, and Return in a code block inserts a code
  newline. Shift+Return creates a zettel_break; a selected range is deleted
  before the operation.
- Splitting a linked span now gives the new span the same resolved link
  destination. Rich paste resolves link metadata for inserted spans and
  images.
- Multi-block rich paste at a text caret retains every pasted block and the
  original trailing content. The previous implementation inserted only the
  first block and could place it before the target block.
- Copying across paragraphs now emits separate selected text blocks instead of
  flattening them into one block. A partial table-cell selection emits a
  selected table fragment. Copied nodes still receive fresh keys on paste.
- Checklist inputs are enabled. A real browser click now updates the list item
  through the stable Zettel key.
- Unknown inline nodes retain their inline placement in Lexical JSON through an
  explicit inline serialization flag.
- Lexical ElementNode serializers now leave child ownership to Lexical's
  exporter, preventing nested rows, cells, and blocks from being duplicated
  in saved state. Span import also strips Lexical envelope fields before
  rebuilding the AST-facing value.
- Combined link and decorator spans now render an anchor containing the
  decorator element, preserving both browser link behavior and mark styling.
  Linked images receive the same anchor treatment.
- Internal clipboard documents use the public schema assertion, so opaque
  extension atoms survive paste. If static HTML has no extension handler,
  copy retains JSON and plain text and emits an escaped inert HTML fragment.
  Opaque inline payloads retain their original shape; clipboard remapping
  does not invent core mark fields for extension data.
- Splitting or multi-block pasting a linked span clones its mark definitions
  and rewrites trailing marks, keeping every annotation key unique across the
  document.
- loadDocument and toLexicalState reject an unknown schema before clearing or
  serializing editor state. This prevents an unsupported document from being
  silently rewritten as schema/1.

## Reproduced contract cases

Before the fixes, Chromium showed the following behavior:

| Priority | Case | Observed behavior | Contract impact |
| --- | --- | --- | --- |
| P1 | Return in list/quote/table/code | A new empty root paragraph appeared after the container; code text was unchanged. | Editing moved content out of its owner or dropped the requested edit. |
| P1 | Shift+Return | It followed the same root-paragraph path and did not create a hard break. | Explicit zettel_break semantics were unavailable. |
| P1 | Two-paragraph paste at a caret | Only the first pasted text block was handled by the inline fast path; the old implementation could also reorder it ahead of the target. | Rich clipboard paste lost document structure. |
| P1 | Copy selection spanning two paragraphs | "rstsec" was exported as one text block with the first block's definitions. | Selected block structure and annotation scope were lost. |
| P1 | Partial table-cell copy | The fallback selected the whole table. | Copy did not honor a text-only selection. |
| P1 | Checklist click | The rendered checkbox had disabled, so a user click could not change state. | The documented browser interaction was impossible. |
| P2 | Split linked span | The trailing span retained the link mark in JSON but had no anchor in the editor DOM before the fix. | Editor presentation diverged from static link semantics. |

The probes also cover nested table/image conversion, fresh keys on internal
paste, malformed HTML fallback, raw HTML read-only atoms, and shared mark
definitions. Core AST equality holds for the nested table/image conversion
fixture after the envelope round trip; serialized Lexical version fields are
expected envelope metadata.

## Remaining limitations for follow-up

The editor table DOM appends rows directly beneath table; the static renderer
uses thead/tbody. Visual styles and export semantics agree in the current
browser checks, but consumers that query table sections or rely on screen-reader
header grouping should add a Lexical table-section strategy.

Partial selections inside nested list items are represented as selected text
blocks rather than a reconstructed list fragment. This retains selected text
and marks without copying unrelated list items; preserving list ownership would
require a structural fragment model for nested containers.
