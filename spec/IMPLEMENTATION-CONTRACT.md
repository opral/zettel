# Implementation contract (breaking replacement)

Document: `{ $schema: SCHEMA_URL, blocks: Block[] }`. SCHEMA_URL = `https://zettel.dev/schema/1/schema.json` (identifier; publication is separate, do not claim hosted).
All nodes have `type` (reserved builtins `zettel_*`) and `zettel_key` (document-unique nonempty ASCII alphanumeric/hyphen/underscore). Keys persist in JSON/editor edits; Markdown generates fresh keys.

Types:
- TextBlock: `{type:'zettel_text',zettel_key,style:'normal'|'h1'..'h6',children:Inline[],markDefs:Link[]}`.
- Span: `{type:'zettel_span',zettel_key,text:string,marks:string[]}`. Nonempty text, LF allowed as soft break; hard break is explicit node.
- Link: `{type:'zettel_link',zettel_key,href:string,title?:string}` in markDefs only. marks are decorators strong/em/strike-through/code or block-local link keys, at most one link per span. Definitions shared across spans. No underline initially (GFM scope).
- Break: `{type:'zettel_break',zettel_key,marks:string[]}` inline, hard break.
- Image: `{type:'zettel_image',zettel_key,src:string,alt:string,title?:string,marks:string[]}` inline.
- InlineHtml: `{type:'zettel_html_inline',zettel_key,value:string,marks:string[]}` inline raw source.
- List: `{type:'zettel_list',zettel_key,kind:'bullet'|'number',start?:number,spread:boolean,items:ListItem[]}`; start required for number, absent bullet. GFM task items can mix with ordinary items, even ordered lists.
- ListItem: `{type:'zettel_list_item',zettel_key,blocks:Block[],spread:boolean,checked?:boolean}`; checked only when task item. Empty items allowed (Markdown supports them).
- Quote: `{type:'zettel_quote',zettel_key,blocks:Block[]}`.
- Code: `{type:'zettel_code',zettel_key,code:string,language?:string,meta?:string}`.
- Rule: `{type:'zettel_rule',zettel_key}`.
- Table: `{type:'zettel_table',zettel_key,align:('left'|'right'|'center'|null)[],rows:TableRow[]}` first row header; rectangular, nonempty.
- TableRow: `{type:'zettel_table_row',zettel_key,cells:TableCell[]}`.
- TableCell: `{type:'zettel_table_cell',zettel_key,children:Inline[],markDefs:Link[]}`.
- Html: `{type:'zettel_html',zettel_key,value:string}` raw block source.
- Extension block/inline: `{type:string,zettel_key:string,...JSON payload}` registered explicitly, reserved zettel_ namespace cannot be overridden. Unknown preserve/read-only, strict validation rejects unregistered types. No silent loss.

AST exports types above, Document, Block, Inline, generateKey(), SCHEMA_URL, documentSchema, validateDocument(value,options?) -> {ok,errors:[{path,message}]}; assertDocument(value,options?) throws. options `blocks` and `inline` maps type-> callback(payload)->string[]. May add createDocument(blocks=[]).

Markdown exports fromMarkdown(source): Document; toMarkdown(doc): string; throw explicit conversion error on unsupported/lossy export. Use remark-parse + remark-gfm + remark-stringify. Semantics not original bytes (canonicalization allowed). Preserve GFM list ownership, task state, table alignment, HTML raw text. Semantic normalization helpers optional.

HTML exports toHtml(doc): string (wrapper .zettel); fromHtml(html, options?): Document; importHtml(html,options?): {document,diagnostics}. Pure fragment parsing (parse5, no browser required), raw Zettel HTML escapes into read-only source by default (no execution). CSS export ./style.css. Canonical content classes: zettel, zettel_text, zettel_list, zettel_list_item, zettel_quote, zettel_code, zettel_rule, zettel_table, zettel_image, zettel_html; standard semantic p/h1/h2/etc ol/ul/li/blockquote/pre/code/hr/table/thead/tbody/tr/th/td/img. tight lists omit paragraph margins via class/data attr. CSS variables and stable classes shared with Lexical. Allowed URL policy; links safe protocols, images no script/data by default. HTML paste strips scripts/styles/event handlers, preserves supported semantics and reports dropped content. Extension custom handlers can be added deliberately.

Lexical exports documented node registry/theme, direct import/export and clipboard integration; MUST allow actual text editing (not whole-document opaque decorator). Stable zettel keys stored independently of Lexical ephemeral keys. Shared marks identity and source metadata preserved on unchanged content; meaningful updates export correctly. Unsupported raw HTML/custom content preserved with read-only atom. Same stylesheet/content semantics as static render; editor-only wrappers allowed with documented exceptions and tests. Own tests headless + jsdom and real browser playground root-owned.

No backward compatibility. Replace legacy root exports and remove obsolete /v1 and old tests.
