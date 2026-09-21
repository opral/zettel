# @opral/zettel-lexical

Lexical bindings for the Zettel document format. Zettel keys are stored as
editor node data, independently of Lexical's ephemeral node keys, so loading
and exporting an unchanged document preserves keys and shared `markDefs`
arrays. Text is represented by real Lexical `TextNode` instances and remains
editable with the normal Lexical selection, keyboard, and formatting APIs.

```ts
import {
  createZettelEditor,
  loadDocument,
  exportDocument,
  registerZettelLexicalPlugin,
} from "@opral/zettel-lexical";

const editor = createZettelEditor();
registerZettelLexicalPlugin(editor);
loadDocument(editor, {
  _type: "zettel_doc",
  blocks: [{
    _type: "zettel_block",
    _key: "intro",
    style: "normal",
    markDefs: [],
    children: [{ _type: "zettel_span", _key: "hello", text: "Hello", marks: [] }],
  }],
});

const document = exportDocument(editor);
```

`createNodeRegistry` accepts explicitly registered extension type names. Raw
HTML and unregistered extension values are displayed through read-only nodes
and round-trip in the exported AST. `copyDocumentToClipboard` and
`pasteClipboardData` expose the same `text/zettel`, HTML, and plain text
formats used by the plugin. HTML conversion is delegated to
`@opral/zettel-html`, which also owns the content classes and stylesheet.
Checklist state can be changed programmatically with
`setZettelListItemChecked(editor, zettelKey, checked)`; the plugin also wires
checkbox changes from a mounted editor to that command.

Code blocks use editable Lexical text children, while raw block and inline HTML
and unknown extension nodes stay read-only source atoms. Pasting a document at
a text caret inserts its inline content at that caret; multi-block pastes use
Lexical's block insertion behavior. The adapter delegates HTML sanitization and
rendering to `@opral/zettel-html`.
