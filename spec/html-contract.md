# HTML and shared stylesheet contract

The static renderer and Lexical editor use a `.zettel` content root. The shared stylesheet is exported from `@opral/zettel-html/style.css`. Applications can override the documented CSS variables or replace that stylesheet. Editor toolbar, focus, selection, and caret affordances are separate from content styling.

Use semantic HTML: paragraphs and headings, spans and formatting elements, anchors, images, explicit hard breaks, ordered/unordered lists and list items, blockquotes, pre/code, thematic breaks, and tables with a header and body. Stable `zettel_*` classes identify content types. Ordered starts, table alignment, and checklist state carry the same presentation meaning in static and editable output.

Editable DOM may include helper wrappers, `contenteditable` attributes, placeholder breaks, and controls needed by Lexical. Those are not canonical document content. The binding must preserve document meaning and match the shared stylesheet's layout; literal DOM equality is not required. Tests should compare list ownership, table cells, shared annotations, and rendered styles rather than serializing the entire editing DOM as a document.

## HTML output

Rendering must escape text and attributes, constrain URL schemes, and never execute raw HTML nodes. The default raw-HTML representation is escaped read-only source. Static rendering must work without mounting an editor. It does not require access to a Lix database, account, or attachment store.

## Clipboard fragments

HTML import accepts fragments for rich paste, not arbitrary websites as a layout format. Preserve supported formatting, links, images, lists, table content, and block structure. Ignore external fonts, colors, and layout. Drop active content such as scripts and event handlers, with diagnostics where applicable. Preserve readable text when unsupported wrappers can be safely unwrapped. Structural cases with no faithful representation must produce diagnostics rather than silently claiming a lossless conversion.

Lexical owns clipboard priority, insertion into the selection, and plain-text fallback. The HTML package owns reusable fragment conversion and the shared content classes. Internal editor copy/paste must allocate fresh document keys for copied nodes; moving or editing existing content retains identity.
