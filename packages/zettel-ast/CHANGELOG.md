# @opral/zettel-ast

## 1.2.0

### Minor Changes

- e77dd8f: Add the `underline` decorator mark. Cmd+U in the Lexical editor underlines, and it round-trips as `<u>` in HTML (`<u>` and `<ins>` import) and as inline `<u>…</u>` in Markdown, which has no underline syntax. Formats Zettel still cannot store (sub/superscript, highlight) are ignored instead of silently splitting spans.

## 1.1.0

### Minor Changes

- 4054023: Replace previous Zettel formats and APIs with the versioned JSON Schema document contract: namespaced nodes, stable keys, shared annotations, explicit GFM containers, Markdown conversion, semantic HTML and shared CSS, HTML clipboard import, and direct Lexical editing. This is a breaking replacement with no compatibility or migration layer. The schema identifier's website is not deployed by this change.

## 0.2.0

### Minor Changes

- 57e6245: Use a lazy, Cloudflare-safe validator fallback (TypeBox Value.Check) to avoid eval in restricted environments. See https://github.com/sinclairzx81/typebox/issues/1095.
