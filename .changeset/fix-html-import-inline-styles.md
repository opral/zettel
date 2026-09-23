---
"@opral/zettel-html": patch
---

Read formatting from inline styles when importing HTML, so pasting from Google Docs or Word online keeps bold, italic, underline and strike-through (`font-weight`, `font-style`, `text-decoration`). An explicit `font-weight:normal` cancels an ancestor's bold, so Google Docs' `<b style="font-weight:normal" id="docs-internal-guid-…">` wrapper no longer turns plain words bold. A `<br>` between blocks imports as an empty paragraph instead of a paragraph holding a hard break, and the `Apple-interchange-newline` break that ends a copied selection is dropped.

Clean up Word desktop and Outlook clipboard HTML on import. Office namespace tags (`<o:p>`, `<w:*>`, `<v:*>`, `<st1:*>` and other `prefix:name` tags) are no longer kept as read-only inline HTML: empty ones are dropped and the others keep only their content. Word list paragraphs (`MsoListParagraph` with `mso-list:l0 level1 …`) import as real bullet or numbered lists, nested by level, without the literal `·`/`1.` marker, and hidden `mso-hide:all` text is dropped. Word's line-wrapped HTML has its whitespace collapsed the way a browser renders it.
