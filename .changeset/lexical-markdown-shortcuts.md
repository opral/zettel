---
"@opral/zettel-lexical": minor
---

Add opt-in Markdown shortcuts: `registerZettelLexicalPlugin(editor, { markdownShortcuts: true })`. They format `**bold**`/`__bold__`, `*italic*`/`_italic_`, `` `code` `` and `~~strike~~` as the closing marker is typed. `- `/`* `, `1. ` and `> ` at the start of a paragraph start a list or a quote. Bare http(s) URLs are linked on space, on Return and on paste, and pasting a URL over selected text links it. Undo reverts a conversion in one step. `onLinkShortcut` handles Cmd/Ctrl+K on selected text or a link, with the link UI supplied by the application.
