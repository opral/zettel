---
"@opral/zettel-html": patch
---

Read formatting from inline styles when importing HTML, so pasting from Google Docs or Word online keeps bold, italic, underline and strike-through (`font-weight`, `font-style`, `text-decoration`). An explicit `font-weight:normal` cancels an ancestor's bold, so Google Docs' `<b style="font-weight:normal" id="docs-internal-guid-…">` wrapper no longer turns plain words bold. A `<br>` between blocks imports as an empty paragraph instead of a paragraph holding a hard break, and the `Apple-interchange-newline` break that ends a copied selection is dropped.
