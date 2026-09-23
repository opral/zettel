---
"@opral/zettel-ast": minor
"@opral/zettel-html": minor
"@opral/zettel-markdown": minor
"@opral/zettel-lexical": minor
---

Add the `underline` decorator mark. Cmd+U in the Lexical editor underlines, and it round-trips as `<u>` in HTML (`<u>` and `<ins>` import) and as inline `<u>…</u>` in Markdown, which has no underline syntax. Formats Zettel still cannot store (sub/superscript, highlight) are ignored instead of silently splitting spans.
