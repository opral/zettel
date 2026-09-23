# Zettel

A **portable JSON format for rich text**, designed for storage, interchange, and editing across applications. Author in Markdown or JSON, edit with Lexical, and render as HTML.

> **Zettel** is German for “a scrap of paper that anything can be written on.”

Zettel defines a shared document model independently of any editor or database. It standardizes the nodes needed for GitHub Flavored Markdown (GFM), with extension points for application-specific content.

## 🧩 Why Zettel?

One document format for storage, agents, editors, and rendering.

- 📦 **Portable** — store documents as JSON in a database row, file, or API response.
- 🔍 **Explicit** — `_type: "zettel_doc"` identifies a Zettel document.
- 🔧 **Extensible** — register application-specific block and inline node types.
- 📐 **Structured** — explicit containers, stable keys, and shared link annotations.
- 🔄 **Interoperable** — GFM import/export, HTML import/rendering, and Lexical bindings.
- 🎨 **Consistent styling** — one content stylesheet for static HTML and the editor.

## 🚚 Interoperability principles

| Principle | Practice |
| --- | --- |
| **Document wrapper** | `{ "_type": "zettel_doc", "blocks": […] }` identifies the document and holds its ordered blocks. |
| **Stable identities** | Every content node and annotation definition has a document-unique `_key`. |
| **Explicit structure** | Lists, list items, quotes, and tables own their children, including nested blocks. |
| **Namespaced types** | Built-in types use `zettel_*`; application types use their own names. |
| **Preserve unknown content** | Retain unsupported payloads as read-only content or reject the operation explicitly. Never silently discard them. |
| **Validation** | JSON Schema describes shapes; runtime validation also checks keys, annotation references, and table dimensions. |

Documents currently carry neither `$schema` nor `version`; applications select the schema they support. The root has no `_key`. Keys identify content across edits; they do not provide a merge algorithm.

## ✨ A document

```json
{
  "_type": "zettel_doc",
  "blocks": [
    {
      "_type": "zettel_block",
      "_key": "p1",
      "style": "normal",
      "markDefs": [],
      "children": [
        {
          "_type": "zettel_span",
          "_key": "s1",
          "text": "Hello, world!",
          "marks": []
        }
      ]
    }
  ]
}
```

Paragraphs and headings share `zettel_block`. Changing `style` from `normal` to `h1` preserves the block’s identity. Quotes and lists are containers because they can contain multiple blocks.

## 🧱 Built-in nodes

| Content | Representation |
| --- | --- |
| Paragraphs and headings | `zettel_block`, with `normal` or `h1`–`h6` style |
| Text | `zettel_span` |
| Hard line breaks | `zettel_break` |
| Links | `zettel_link` definitions referenced through `marks` |
| Images | `zettel_image` |
| Ordered, unordered, and task lists | `zettel_list` and `zettel_list_item`; task state belongs to the item |
| Blockquotes | `zettel_quote` |
| Fenced or indented code | `zettel_code`, with optional language and metadata |
| Thematic breaks | `zettel_rule` |
| Tables | `zettel_table`, `zettel_table_row`, and `zettel_table_cell`, with column alignment |
| Raw HTML source | `zettel_html` and `zettel_html_inline` |

List items can contain multiple paragraphs, nested lists, quotes, and other blocks. Soft line breaks remain LF characters in text; hard breaks have an explicit node.

### Marks and shared annotations

`marks` contains decorator strings (`strong`, `em`, `underline`, `strike-through`, `code`) and references to local annotation definitions. Link objects live in the enclosing text block or table cell’s `markDefs`.

```json
{
  "_type": "zettel_block",
  "_key": "p2",
  "style": "normal",
  "markDefs": [
    {
      "_type": "zettel_link",
      "_key": "link1",
      "href": "https://example.com"
    }
  ],
  "children": [
    {
      "_type": "zettel_span",
      "_key": "s2",
      "text": "Read the ",
      "marks": ["link1"]
    },
    {
      "_type": "zettel_span",
      "_key": "s3",
      "text": "proposal",
      "marks": ["link1", "strong"]
    }
  ]
}
```

Both spans share one link while retaining different formatting. This follows Portable Text’s shared annotation approach; Zettel’s vocabulary and container model are its own format.

## 🔄 Markdown and HTML

```ts
import { fromMarkdown, toMarkdown } from "@opral/zettel-markdown";
import { toHtml, importHtml } from "@opral/zettel-html";
import "@opral/zettel-html/style.css";

const document = fromMarkdown("# Hello\n\n- [x] Ship commenting\n");
const markdown = toMarkdown(document);
const html = toHtml(document);

const pasted = importHtml("<p><strong>Rich</strong> paste</p>");
// Inspect pasted.diagnostics for unsupported or removed content.
```

Markdown export is canonical: delimiter choices and source layout can change. Markdown import creates fresh keys. Use JSON when identities and extension payloads must survive unchanged. Unsupported JSON-to-Markdown conversions fail explicitly.

HTML import supports rich clipboard fragments and reports lossy conversions. Raw HTML nodes retain their source but render as escaped, inert content by default.

## ✍️ Lexical editing

```ts
import {
  createZettelEditor,
  registerZettelLexicalPlugin,
  loadDocument,
  exportDocument,
} from "@opral/zettel-lexical";
import "@opral/zettel-html/style.css";

const editor = createZettelEditor();
editor.setRootElement(documentElement);
const unregister = registerZettelLexicalPlugin(editor);

loadDocument(editor, document);
const updatedDocument = exportDocument(editor);
```

The binding uses editable Lexical nodes and preserves Zettel identities independently of Lexical’s internal keys. Static HTML and the editor share content classes and a stylesheet; editor-specific DOM wrappers may differ.

## 🔧 Extending Zettel

Applications can define block or inline atoms outside the reserved `zettel_` namespace:

```json
{
  "_type": "acme_attachment",
  "_key": "attachment1",
  "file_id": "file123",
  "label": "Project brief.pdf"
}
```

Register the type’s JSON Schema and runtime payload validator in your application profile. Add rendering or conversion handlers where needed. Core nodes remain closed objects; defining a custom type does not automatically give an editor or Markdown exporter its semantics.

The Lexical binding preserves unknown application atoms as read-only content. Core-only validation rejects unregistered types. Invalid document roots are rejected.

See [compatibility and extensions](spec/compatibility.md).

## 📦 Packages

| Package | Responsibility |
| --- | --- |
| `@opral/zettel-ast` | Types, JSON Schema, runtime validation, and extension slots |
| `@opral/zettel-markdown` | GFM import and canonical Markdown export |
| `@opral/zettel-html` | HTML rendering, fragment import, and shared CSS |
| `@opral/zettel-lexical` | Editing bindings, document conversion, and clipboard integration |

Zettel describes document content. Comments, authorship, reactions, attachment storage, access control, and version-control merging belong to the surrounding application.

## 🛠️ Develop

```sh
pnpm install
pnpm build
pnpm test
pnpm demo
```

The [local playground](http://localhost:4176) shows Markdown, JSON, a Lexical editor, and static HTML side by side.

```sh
pnpm --filter zettel-playground exec playwright install chromium
pnpm test:demo
```

`BROWSER_BIN` can select an existing Chromium executable. Generate the bundled schema with `pnpm schema:v1`.

## Specification and status

Read the [format specification](spec/v1.md), [JSON Schema](spec/v1.schema.json), [HTML contract](spec/html-contract.md), and [verification report](spec/VERIFICATION.md).

This development version replaces earlier Zettel formats and APIs without backward compatibility. The schema ships as `@opral/zettel-ast/schema.json`; its public URL is an identifier whose hosting is not deployed by this branch. Register the bundled schema locally for validation.

Verification includes 61 package tests, semantic round trips across 672 upstream GFM examples, and 16 Chromium scenarios. The verification report records the review findings, fixes, and remaining editor limitations.
