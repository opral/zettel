# @opral/zettel-markdown

## 1.2.0

### Minor Changes

- e77dd8f: Add the `underline` decorator mark. Cmd+U in the Lexical editor underlines, and it round-trips as `<u>` in HTML (`<u>` and `<ins>` import) and as inline `<u>…</u>` in Markdown, which has no underline syntax. Formats Zettel still cannot store (sub/superscript, highlight) are ignored instead of silently splitting spans.

### Patch Changes

- Updated dependencies [e77dd8f]
  - @opral/zettel-ast@1.2.0

## 1.1.0

### Minor Changes

- 4054023: Replace previous Zettel formats and APIs with the versioned JSON Schema document contract: namespaced nodes, stable keys, shared annotations, explicit GFM containers, Markdown conversion, semantic HTML and shared CSS, HTML clipboard import, and direct Lexical editing. This is a breaking replacement with no compatibility or migration layer. The schema identifier's website is not deployed by this change.

### Patch Changes

- Updated dependencies [4054023]
  - @opral/zettel-ast@1.1.0
