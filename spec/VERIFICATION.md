# Candidate verification

Verified locally on 2026-09-21 with Node 22.23.2 and pnpm 10.30.3.

## Executed checks

| Check | Result |
| --- | --- |
| Workspace TypeScript build | All three packages pass |
| AST tests, including v1 adversarial validation and type fixtures | 29 pass; one existing legacy skip |
| Legacy HTML tests | 17 pass |
| Legacy Lexical tests | Nine existing TODOs; no passing editor-binding claim |
| Demo Markdown conversion | 16 pass |
| Real Lix server integration | Pass: registered schemas, FK inserts, JSONB, exact file bytes, snapshot reload, invalid writes, route validation, reference identity |
| Chromium browser | Eight scenario checks pass; no page errors |
| Schema generation and Git whitespace check | Pass |

`pnpm lint` exits successfully, but the packages define no lint tasks; this is not lint coverage.

Browser scenarios cover seeded containers, Markdown posting, JSON rejection/editing with stable keys, attachment upload/download, engine-generated mentions, database export, unknown-version read-only handling, and a 390px layout. The runner writes screenshots and a result JSON under ignored `examples/lix-comments/artifacts/`.

## Review

Separate GPT-5.6 Luna agents at extra-high reasoning reviewed the core/specification and the application. Original findings and follow-up resolutions are retained in [core review](REVIEW-core.md) and [demo review](REVIEW-demo.md). These are implementation reviews, not blind format preference experiments.

## Scope limits

The demo uses the sibling Lix SDK at commit `d2823d93f390fc2f803c48472b157bb16939efb2` (0.17.1); it is not vendored. Conversation/comment rows use global scope to resolve the built-in account FK. Files and the actual checkpoint use main. See the [demo README](../examples/lix-comments/README.md) for the engine limitation and setup.

This verifies a candidate data contract and throwaway application. It does not verify production Tiptap/Lexical v1 bindings, concurrent merge behavior, branch-local conversation semantics, permission enforcement, notifications, or compatibility with arbitrary Portable Text renderers. No structural merger is installed. The legacy package entry points retain their prior representation.
