# Zettel playground

From the repository root, run `pnpm install && pnpm demo`, then open http://localhost:4176.

The four panes show GFM input, the Lexical editor, canonical document JSON, and standalone HTML. Apply Markdown or JSON to replace the active document; editing updates JSON and HTML. Export Markdown explicitly because it normalizes syntax and cannot represent every arbitrary JSON extension. Both rendering surfaces use the same `@opral/zettel-html/style.css`.

Try a multi-paragraph list item, mixed task list, aligned table, linked image, code fence, or formatted clipboard paste. Unsupported document schemas and invalid JSON report an error and leave the input available for inspection. Content is local to the tab, not persisted to a database. No Lix SDK is needed.

`pnpm test:demo` runs browser scenarios. Install Playwright Chromium first or set `BROWSER_BIN` to an available executable. Browser artifacts are ignored by Git.

The playground serves the bundled schema at `/schema/1/schema.json` for inspection. Its canonical public identifier remains the URL in the document; production hosting of that identifier is a separate release step.

HTML paste diagnostics remain visible in the playground. Browser verification covers 16 editing/rendering scenarios; see the repository verification report for coverage and remaining binding limitations.
