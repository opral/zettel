# @opral/zettel-html

Server safe HTML rendering and clipboard fragment import for Zettel documents.

```ts
import { fromHtml, importHtml, toHtml } from "@opral/zettel-html";

const html = toHtml(document);
const documentAgain = fromHtml(html);
const pasted = importHtml(clipboardHtml);
console.log(pasted.diagnostics);
```

`toHtml` emits a `.zettel` wrapper and stable semantic elements with
`data-zettel-key` attributes. `importHtml` accepts a fragment and reports
dropped scripts, styles, event attributes, unsafe URLs, invalid keys, and
unsupported elements that were preserved as read-only `zettel_html` nodes.
The parser uses `parse5`, so importing HTML does not require a browser or
execute source markup.

Raw HTML nodes are escaped on export. Links permit `http`, `https`, `mailto`,
and `tel` URLs; images permit `http` and `https` URLs. Relative URLs and fragments are also supported. Data images can be
enabled deliberately with `{ allowDataImages: true }`.

The shared content stylesheet is available as `@opral/zettel-html/style.css`.
It uses the stable `zettel`, `zettel_text`, `zettel_list`, `zettel_list_item`,
`zettel_quote`, `zettel_code`, `zettel_rule`, `zettel_table`, `zettel_image`,
and `zettel_html` classes used by static output and the Lexical integration.

Use `importHtml` when accepting clipboard content so you can show its diagnostics.
`fromHtml` is a convenience that returns only the document. Ragged tables are
padded without discarding cells; unsupported cell spans retain cell content
and produce a warning. Import never returns a document that fails the registered
profile's structural validation. Custom handlers own their payload semantics.
