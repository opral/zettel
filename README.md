# Zettel

A portable JSON rich-text format with a small, specified vocabulary across editors and applications.

**This development branch defines Zettel v1 as a Portable Text–based profile.** It keeps `block`, `span`, `marks`, and `markDefs`, and specifies explicit lists, list items, quotes, code, and dividers. Applications add their own reference and attachment atoms.

- [Candidate v1 specification](spec/v1.md)
- [Runnable Lix comments demo](examples/lix-comments/README.md)
- [Legacy 0.2 format](spec/legacy-0.2.md)

```json
{
  "format": "zettel",
  "version": 1,
  "blocks": [{
    "_type": "block",
    "_key": "paragraph_1",
    "style": "normal",
    "markDefs": [],
    "children": [{
      "_type": "span",
      "_key": "text_1",
      "text": "Portable text, with shared conventions.",
      "marks": []
    }]
  }]
}
```

The v1 reference implementation is an explicit subpath:

```ts
import { validateDocument, generateKey } from '@opral/zettel-ast/v1';
```

An ordered root block array remains simple to store in a JSONB cell. Explicit containers preserve multi-paragraph list items and nested quotes. Block-local link definitions keep one shared link across differently formatted spans. Stable keys identify content independently of its position.

Zettel specifies data, not a renderer, database, merge algorithm, or asset store. It is not a drop-in replacement for arbitrary Portable Text schemas: custom object renderers must understand its containers, and the envelope is Zettel-specific. Markdown import/export has an explicit supported subset.

## Development

```sh
pnpm install
pnpm build
pnpm test
```

The existing package root, `zettel-html`, and `zettel-lexical` retain legacy behavior. They do not consume v1 documents. This draft is intentionally isolated from published consumers; there is no automatic legacy migration or production v1 editor binding yet.

To run the throwaway app, see its [setup and limitations](examples/lix-comments/README.md).
