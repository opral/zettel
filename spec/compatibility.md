# Compatibility and extensions

Documents identify themselves with `_type: "zettel_doc"`; they carry no schema URL or version. The host selects the bundled schema/application profile. Reject invalid roots and unsupported structures rather than silently reinterpreting them. This release intentionally provides no compatibility with previous Zettel drafts or package-root APIs.

Known core nodes are closed objects. Extension names must not start with `zettel_`. The schema exposes `extensionBlock` and `extensionInline` slots recursively. `createDocumentSchema({blocks:[...schemas],inline:[...schemas]})` builds an application profile from those slots, while `validateDocument(value,{blocks:{app_card:validateCard},inline:{...}})` registers runtime payload validators. The host must use matching schema and validator registrations. A schema definition alone cannot provide rendering, editing, or Markdown semantics.

Runtime validators receive detached payload copies. Core validation checks JSON data shape, unique keys across known nodes and extension atoms, and block-local annotation references. Extension payload descendants are application data, not automatically Zettel nodes; their invariants belong to their validator. Callbacks do not confer permission to mutate the source document.

A document with an unsupported node remains valid for its owning application profile even if a core-only client cannot validate/edit it. Clients must retain the original payload. A read-only placeholder is acceptable; dropping nodes, rewriting their fields, or inventing Markdown semantics is not. Applications can also keep an entire unsupported document read-only.

Markdown is interchange, not an identity-preserving backup. Preserve JSON when keys, extension payloads, or annotation identity must survive unchanged. Export must fail explicitly for unrepresentable values; callers may separately choose a fallback. Plain-text clipboard paste creates new keys. Copies must not reuse the source document's identities in the destination.

## Schema publication

The schema URL is an identifier reserved for the proposed release, not proof of a deployed endpoint. Bundled `@opral/zettel-ast/schema.json` and the checked-in schema support offline validation now. Before release, deploy the exact immutable schema and documentation at that URL. Do not replace its meaning with an incompatible schema. Registered application profile identifiers and their schema publication are the application owner's responsibility.
