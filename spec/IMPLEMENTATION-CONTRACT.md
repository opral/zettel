# Implementation contract (breaking replacement)

Document: `{ _type: "zettel_doc", blocks: Block[] }`. SCHEMA_URL = `https://zettel.dev/schema/1/schema.json` (identifier; publication is separate, do not claim hosted).
All content nodes have `_type` (reserved builtins `zettel_*`) and `_key` (document-unique nonempty ASCII alphanumeric/hyphen/underscore). Keys persist in JSON/editor edits; Markdown generates fresh keys.

Types:
- TextBlock: `{_type:'zettel_block',_key,style:'normal'|'h1'..'h6',children:Inline[],markDefs:Link[]}`.
- Span: `{_type:'zettel_span',_key,text:string,marks:string[]}`. Nonempty text, LF allowed as soft break; hard break is explicit node.
- Link: `{_type:'zettel_link',_key,href:string,title?:string}` in markDefs only. marks are decorators strong/em/underline/strike-through/code or block-local link keys, at most one link per span. Definitions shared across spans. Underline has no GFM syntax: Markdown carries it as inline `<u>…</u>` (and reads `<ins>`), HTML as `<u>`.
- Break: `{_type:'zettel_break',_key,marks:string[]}` inline, hard break.
- Image: `{_type:'zettel_image',_key,src:string,alt:string,title?:string,marks:string[]}` inline.
- InlineHtml: `{_type:'zettel_html_inline',_key,value:string,marks:string[]}` inline raw source.
- List: `{_type:'zettel_list',_key,kind:'bullet'|'number',start?:number,spread:boolean,items:ListItem[]}`; start required for number, absent bullet. GFM task items can mix with ordinary items, even ordered lists.
- ListItem: `{_type:'zettel_list_item',_key,blocks:Block[],spread:boolean,checked?:boolean}`; checked only when task item. Empty items allowed (Markdown supports them).
- Quote: `{_type:'zettel_quote',_key,blocks:Block[]}`.
- Code: `{_type:'zettel_code',_key,code:string,language?:string,meta?:string}`.
- Rule: `{_type:'zettel_rule',_key}`.
- Table: `{_type:'zettel_table',_key,align:('left'|'right'|'center'|null)[],rows:TableRow[]}` first row header; rectangular, nonempty.
- TableRow: `{_type:'zettel_table_row',_key,cells:TableCell[]}`.
- TableCell: `{_type:'zettel_table_cell',_key,children:Inline[],markDefs:Link[]}`.
- Html: `{_type:'zettel_html',_key,value:string}` raw block source.
- Extension block/inline: `{_type:string,_key:string,...JSON payload}` registered explicitly, reserved zettel_ namespace cannot be overridden. Unknown preserve/read-only, strict validation rejects unregistered types. No silent loss.

AST exports types above, Document, Block, Inline, generateKey(), SCHEMA_URL, documentSchema, validateDocument(value,options?) -> {ok,errors:[{path,message}]}; assertDocument(value,options?) throws. options `blocks` and `inline` maps type-> callback(payload)->string[]. May add createDocument(blocks=[]).

Markdown exports fromMarkdown(source): Document; toMarkdown(doc): string; throw explicit conversion error on unsupported/lossy export. Use remark-parse + remark-gfm + remark-stringify. Semantics not original bytes (canonicalization allowed). Preserve GFM list ownership, task state, table alignment, HTML raw text. Semantic normalization helpers optional.

HTML exports toHtml(doc): string (wrapper .zettel); fromHtml(html, options?): Document; importHtml(html,options?): {document,diagnostics}. Pure fragment parsing (parse5, no browser required), raw Zettel HTML escapes into read-only source by default (no execution). CSS export ./style.css. Canonical content classes: zettel, zettel_block, zettel_list, zettel_list_item, zettel_quote, zettel_code, zettel_rule, zettel_table, zettel_image, zettel_html; standard semantic p/h1/h2/etc ol/ul/li/blockquote/pre/code/hr/table/thead/tbody/tr/th/td/img. tight lists omit paragraph margins via class/data attr. CSS variables and stable classes shared with Lexical. Allowed URL policy; links safe protocols, images no script/data by default. HTML paste strips scripts/styles/event handlers, preserves supported semantics and reports dropped content. Extension custom handlers can be added deliberately.

Lexical exports documented node registry/theme, direct import/export and clipboard integration; MUST allow actual text editing (not whole-document opaque decorator). Stable zettel keys stored independently of Lexical ephemeral keys. Shared marks identity and source metadata preserved on unchanged content; meaningful updates export correctly. Unsupported raw HTML/custom content preserved with read-only atom. Same stylesheet/content semantics as static render; editor-only wrappers allowed with documented exceptions and tests. Own tests headless + jsdom and real browser playground root-owned.

No backward compatibility. Replace legacy root exports and remove obsolete /v1 and old tests.
