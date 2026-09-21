# Zettel × Lix comments lab

A throwaway local app showing Zettel v1 stored in real Lix JSONB rows. It is intentionally separate from a production comment service or editor binding.

## Run

Requires Node 22+, pnpm 10, and a built Lix JavaScript SDK. By default it looks for a sibling checkout at `../../../lix/packages/js-sdk/dist/index.js` relative to this directory: `/root/repos-iv/lix` in the research workspace. The tested Lix commit is `d2823d93f390fc2f803c48472b157bb16939efb2` (SDK 0.17.1). This SDK is not vendored in Zettel.

From the Zettel repository root:

```sh
pnpm install
pnpm demo
```

Open **http://127.0.0.1:4174**. To use another SDK build:

```sh
LIX_SDK_PATH=/absolute/path/to/lix/packages/js-sdk/dist/index.js pnpm demo
```

The server binds loopback only. `PORT` overrides 4174. It is a single-account local sandbox with no authentication or notification service; do not expose it as a hosted app.

## Try it

1. Inspect the seeded checkpoint conversation: differently formatted spans share one link definition, and a mention contains an engine-generated RowRef.
2. Open the file conversation to inspect a multi-paragraph list item, nested quote, checklist, code, and attachment.
3. Click **Try nested content**, then post a comment. The rendered list has two items, even though one owns several blocks.
4. Choose **Edit JSON** on a comment. Update a span while retaining its key, then save. Add an unknown field or duplicate a key to see validation reject the change.
5. Insert a mention using **@ Mention**. Upload a file and post it: its bytes live in `lix_file`, while the body contains only `file_id` and display fields.
6. Export Markdown or download the complete `.lix` database snapshot.

The comment body is always `{format:'zettel',version:1,blocks:[...]}`. Conversation and author IDs are normal foreign keys outside the body. The discussion target is an opaque RowRef to a commit or file. See [PROFILE.md](PROFILE.md).

The JSON inspector shows the actual stored body, not an editor-specific copy. Markdown import intentionally creates fresh node keys; edit JSON when identity preservation matters. Export rejects constructs it cannot represent without semantic loss. Unsupported Markdown includes raw HTML, tables, mixed task/ordinary list items, and external images requiring ingestion.

The pinned engine cannot resolve the global `lix_account` row from a main-branch child FK. The demo therefore stores its conversation and comment tables in the global branch, temporarily switching write scope and restoring it afterward. Files and the checkpoint remain on main. This is a prototype workaround, not a recommendation for production conversation versioning; branch merging is not demonstrated.

## Persistence and assets

The server saves an atomic snapshot to `.data/demo.lix` after mutations and reloads it on restart. That directory is ignored by Git. Delete it while the server is stopped to reset the demo. The download action exports the current database with its files. Starting again without this file creates a fresh example database.

Uploads are limited to 8 MiB; JSON requests to 2 MiB. Only PNG/JPEG/GIF/WebP are offered as inline image previews. Other files, including HTML and SVG, are downloads. Uploading a file without posting its comment can leave an unattached file in this throwaway database; asset garbage collection is out of scope.

## Verify

```sh
pnpm test:demo
pnpm --filter zettel-lix-comments-demo exec playwright install chromium
pnpm --filter zettel-lix-comments-demo test:browser
```

The browser test starts an isolated in-memory demo on an ephemeral port. `BROWSER_BIN` can point to an already-installed Chromium binary. It exercises posting nested Markdown, JSON validation/editing, upload/download, mentions, database export, and mobile overflow. Screenshots and results are written to ignored `artifacts/`.

Core tests run with `pnpm test` from the repository root. Generate the machine-readable core schema with `pnpm schema:v1`.

## Boundaries

- This is a data-format demonstration with Markdown/JSON authoring and direct rendering; it does not ship production Tiptap or Lexical v1 bindings.
- No structural merge plugin is installed. Lix's normal cell behavior applies; concurrent preservation is not a Zettel guarantee.
- Validation checks document shape and annotation identity. RowRef prefix validation does not prove target existence or authenticity; IDs embedded in JSON do not acquire FK enforcement.
- The pinned Lix build rejects a child insert with a missing FK target but was observed to allow deletion of a referenced parent. The demo has no deletion route. This engine limitation is separate from the proposed schema semantics.
- The core schema excludes application atoms. The shared `profile.mjs` registers the demo's exact Lix atom shapes for frontend and server validation.
- The legacy `@opral/zettel-html` and `@opral/zettel-lexical` packages do not accept v1 documents. The draft lives at the explicit `/v1` subpath.
