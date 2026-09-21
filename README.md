# Zettel

A versioned JSON document format with GFM conversion, semantic HTML, a shared stylesheet, and Lexical editing.

This development branch is a **breaking replacement**, with no legacy exports or migration layer. It retains Portable Text's shared annotation concept, but uses Zettel's own names and explicit containers. It is not wire-compatible with Portable Text.

```json
{
  "$schema": "https://zettel.dev/schema/1/schema.json",
  "blocks": [{
    "type": "zettel_text",
    "zettel_key": "p1",
    "style": "normal",
    "markDefs": [],
    "children": [{
      "type": "zettel_span",
      "zettel_key": "s1",
      "text": "Hello, world.",
      "marks": []
    }]
  }]
}
```

The schema URL identifies the contract; this branch does not deploy that URL. The JSON Schema ships as `@opral/zettel-ast/schema.json` and [in the repository](spec/v1.schema.json) for local registration and agent discovery. Applications should map the identifier to the bundled schema without depending on a network request for validation.

| Package | Responsibility |
| --- | --- |
| `@opral/zettel-ast` | Types, JSON Schema, identity/reference validation, extension slots |
| `@opral/zettel-markdown` | GFM import and canonical Markdown export |
| `@opral/zettel-html` | Static rendering, clipboard HTML fragment conversion, shared CSS |
| `@opral/zettel-lexical` | Editable nodes, direct document binding, clipboard integration |

```ts
import { fromMarkdown, toMarkdown } from "@opral/zettel-markdown";
import { toHtml, importHtml } from "@opral/zettel-html";
import "@opral/zettel-html/style.css";

const document = fromMarkdown("- [x] Ship commenting\n");
const html = toHtml(document);
const markdown = toMarkdown(document);
const pasted = importHtml("<p><strong>Rich</strong> paste</p>");
// Inspect pasted.diagnostics before accepting a lossy paste.
```

Read the [format](spec/v1.md), [HTML contract](spec/html-contract.md), [compatibility rules](spec/compatibility.md), and [verification report](spec/VERIFICATION.md).

## Develop

```sh
pnpm install
pnpm build
pnpm test
pnpm demo
```

The playground runs at http://localhost:4176 and shows Markdown, JSON, static HTML, and a Lexical editor. Static content and the editor import the same `@opral/zettel-html/style.css`.

```sh
pnpm --filter zettel-playground exec playwright install chromium
pnpm test:demo
```

`BROWSER_BIN` can select an installed Chromium executable. Generate the bundled and repository JSON Schemas with `pnpm schema:v1`.

Comments, authorship, reactions, row targets, asset storage, merge algorithms, and ZIP packaging belong to the surrounding application, outside this format.
