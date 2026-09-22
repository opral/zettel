# @opral/zettel-ast

The canonical Zettel 1 JSON model. Breaking replacement: no legacy root or `/v1` API.

```ts
import { createDocument, generateKey, validateDocument } from '@opral/zettel-ast';
const doc = createDocument([{_type:'zettel_block',_key:generateKey(),style:'normal',markDefs:[],children:[]}]);
const result = validateDocument(doc);
```

Exports TypeScript node types, `SCHEMA_URL`, `documentSchema`, `createDocumentSchema`, `createDocument`, `generateKey`, `validateDocument`, and `assertDocument`. The bundled JSON Schema is exported as `@opral/zettel-ast/schema.json`.

The schema checks structure. Runtime validation additionally checks unique node/annotation keys, resolved local marks, and rectangular tables. Extension callbacks are registered in `blocks`/`inline` maps and receive cloned payloads. Invalid roots and unknown nodes fail core validation; hosts should retain them read-only. Validation performs no fetching or migration.
