# @opral/zettel-html

## 1.2.0

### Minor Changes

- e77dd8f: Add the `underline` decorator mark. Cmd+U in the Lexical editor underlines, and it round-trips as `<u>` in HTML (`<u>` and `<ins>` import) and as inline `<u>…</u>` in Markdown, which has no underline syntax. Formats Zettel still cannot store (sub/superscript, highlight) are ignored instead of silently splitting spans.

### Patch Changes

- bfdef82: Keep typed whitespace visible in editable Zettel content: a trailing space moves the caret, repeated spaces do not collapse, and Chromium no longer stores U+00A0 in place of typed spaces.
- fa8644b: Ignore document metadata (`<meta>`, `<link>`, `<base>`, `<title>`) when importing HTML, so pasting from a web page in Chromium no longer adds a read-only `<meta charset="utf-8">` block.
- 041a823: Import an inline element that wraps block content (as Google Docs does with `<b id="docs-internal-guid-…">`) as a container, so pasted paragraphs and lists stay editable instead of becoming read-only inline HTML.
- 3d43d21: Read formatting from inline styles when importing HTML, so pasting from Google Docs or Word online keeps bold, italic, underline and strike-through (`font-weight`, `font-style`, `text-decoration`). An explicit `font-weight:normal` cancels an ancestor's bold, so Google Docs' `<b style="font-weight:normal" id="docs-internal-guid-…">` wrapper no longer turns plain words bold. A `<br>` between blocks imports as an empty paragraph instead of a paragraph holding a hard break, and the `Apple-interchange-newline` break that ends a copied selection is dropped.

  Clean up Word desktop and Outlook clipboard HTML on import. Office namespace tags (`<o:p>`, `<w:*>`, `<v:*>`, `<st1:*>` and other `prefix:name` tags) are no longer kept as read-only inline HTML: empty ones are dropped and the others keep only their content. Word list paragraphs (`MsoListParagraph` with `mso-list:l0 level1 …`) import as real bullet or numbered lists, nested by level, without the literal `·`/`1.` marker, and hidden `mso-hide:all` text is dropped. Word's line-wrapped HTML has its whitespace collapsed the way a browser renders it.

- e76d0ec: Style inline code as a chip with `--zettel-code-background` and `--zettel-code-color`, the same in the editor and in rendered HTML. Before, inline code only switched to a monospace font, and only code blocks used the code colors. Code inside code blocks is not styled as a chip, and linked code keeps the link color.
- Updated dependencies [e77dd8f]
  - @opral/zettel-ast@1.2.0

## 1.1.0

### Minor Changes

- 4054023: Replace previous Zettel formats and APIs with the versioned JSON Schema document contract: namespaced nodes, stable keys, shared annotations, explicit GFM containers, Markdown conversion, semantic HTML and shared CSS, HTML clipboard import, and direct Lexical editing. This is a breaking replacement with no compatibility or migration layer. The schema identifier's website is not deployed by this change.

### Patch Changes

- Updated dependencies [4054023]
  - @opral/zettel-ast@1.1.0

## 0.1.1

### Patch Changes

- Updated dependencies [57e6245]
  - @opral/zettel-ast@0.2.0
