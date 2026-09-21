# @opral/zettel-markdown

Canonical Markdown conversion for the Zettel 1 document model.

```ts
import { fromMarkdown, toMarkdown } from "@opral/zettel-markdown";

const document = fromMarkdown("# Hello\n\n- [x] done\n");
const markdown = toMarkdown(document);
```

The converter uses `remark-parse` and `remark-gfm` for CommonMark plus the
formal GitHub Flavored Markdown extensions, and `remark-stringify` with
`remark-gfm` for canonical output. The supported input and output corpus is
the cmark-gfm 0.29 specification fixture pinned in `fixtures/gfm`; the
package tests exercise all 672 upstream examples and independently compare
representative output with micromark's GFM HTML implementation.

The Zettel AST has no footnote or other extension node in its core model.
Footnote-looking syntax is disabled so formal GFM inputs such as
`[^a]\n\n[^a]: /url` remain an ordinary reference link. Other remark syntax
that produces an unsupported node is rejected with `MarkdownConversionError`
so content is never silently discarded. Likewise,
export rejects unregistered extension blocks and inline nodes, missing link
definitions, invalid tables, and marks that Markdown cannot represent.

Markdown conversion creates fresh `_key` values. Link definitions are
local to each text block or table cell, and raw HTML is retained as inert
source in `zettel_html` or `zettel_html_inline` nodes.
