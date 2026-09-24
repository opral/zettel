# @opral/zettel-lexical

## 2.0.0

### Major Changes

- 26b1b91: Require Lexical 0.51. The `lexical` peer dependency is now `^0.51.0` (was `^0.30.0`), and `@lexical/history`, `@lexical/utils` and the new `@lexical/extension` dependency are 0.51. Apps must upgrade `lexical` to 0.51 together with this release.

  Editing behavior is kept across the upgrade:

  - Deleting, typing, Enter, paste or cut over a range that starts at the beginning of a block and ends inside a text run of a later block now works. Lexical threw (`$getTextNodeOffset: invalid offset`) and the key press did nothing; it still does in 0.51, so Zettel removes such ranges through a guarded path. `$removeSelectedText(selection)` is exported for apps that remove selected text themselves.
  - A triple click selects only its block again, so typing over it no longer merges the next block (Lexical 0.45 moved this correction out of core).
  - Select-all delete leaves an ordinary Zettel text block with a stable key that Enter can split (Lexical 0.50 leaves a plain `ParagraphNode`).
  - Bold, italic and the other formats toggle off a range whose characters all have them, also when the range was selected in code (Lexical 0.47 toggles by the selection's cached format).
  - Lexical JSON with plain `paragraph` and `text` nodes loads again through `fromLexicalState` (Zettel nodes now have zero-argument constructors, which Lexical 0.49+ requires).

### Minor Changes

- 9b34ba7: Add opt-in Markdown shortcuts: `registerZettelLexicalPlugin(editor, { markdownShortcuts: true })`. They format `**bold**`/`__bold__`, `*italic*`/`_italic_`, `` `code` `` and `~~strike~~` as the closing marker is typed. `- `/`* `, `1. ` and `> ` at the start of a paragraph start a list or a quote. Bare http(s) URLs are linked on space, on Return and on paste, and pasting a URL over selected text links it. Undo reverts a conversion in one step. `onLinkShortcut` handles Cmd/Ctrl+K on selected text or a link, with the link UI supplied by the application.
- e77dd8f: Add the `underline` decorator mark. Cmd+U in the Lexical editor underlines, and it round-trips as `<u>` in HTML (`<u>` and `<ins>` import) and as inline `<u>…</u>` in Markdown, which has no underline syntax. Formats Zettel still cannot store (sub/superscript, highlight) are ignored instead of silently splitting spans.

### Patch Changes

- ee500ee: Handle line deletion: Cmd+Backspace and Cmd+Delete on macOS (and the matching `deleteSoftLine*`/`deleteHardLine*` input types) now delete to the line boundary instead of doing nothing.
- f943737: Preserve character order and spaces when typing across formatting boundaries in the Lexical editor.
- 9bf27fa: Keep text typed after a trailing Shift+Enter hard break. Hard breaks are now Lexical line breaks, so the caret can no longer land inside one, the new line is visible, and select-all deletion removes them.
- 579eff1: Keep links when blocks are joined: Backspace at the start of a block, Delete at the end of one, or deleting a range across blocks moved the joined block's linked spans without their link definitions, so the links were lost and `exportDocument` threw `Unresolved mark`. The moved spans now get a definition in their new block (reusing one with the same href), and a mark that cannot be resolved is dropped instead of breaking the document.
- 6771bfe: Make lists and quotes editable from the keyboard like other rich-text editors. Enter on an empty list item leaves the list (an empty nested item moves up a level) and Enter on an empty last line of a quote leaves the quote. Backspace at the start of a list item, empty or not, keeps its text: a nested item moves up a level and a top-level item becomes a paragraph. Backspace at the start of any quote line moves that line out of the quote, splitting the quote if needed. Neither merges the text into the previous item or leaves an empty bullet. Select all + Delete leaves one empty paragraph. Edits that merge blocks can no longer produce a document that `exportDocument` rejects: empty lists and items are removed, stray text inside list items and quotes is wrapped in a paragraph, and links moved into another block keep a link definition there.
- 978fe3c: Keep the caret in a Zettel block after `loadDocument` replaces the document under it (for example when a comment box clears itself after sending). Typing afterwards no longer creates a stray Lexical paragraph without Zettel classes, in which Shift+Enter made new paragraphs instead of hard breaks. Typing into a document without blocks creates a Zettel text block.
- d321945: Leave the caret after pasted content, so typing continues after the paste instead of before it.
- 53c2788: Apply spell-check suggestions and text drops, whose text arrives in `dataTransfer` rather than `InputEvent.data`, and remove the source text of a drag-and-drop move.
- Updated dependencies [bfdef82]
- Updated dependencies [fa8644b]
- Updated dependencies [041a823]
- Updated dependencies [3d43d21]
- Updated dependencies [e76d0ec]
- Updated dependencies [e77dd8f]
  - @opral/zettel-html@1.2.0
  - @opral/zettel-ast@1.2.0

## 1.1.0

### Minor Changes

- 4054023: Replace previous Zettel formats and APIs with the versioned JSON Schema document contract: namespaced nodes, stable keys, shared annotations, explicit GFM containers, Markdown conversion, semantic HTML and shared CSS, HTML clipboard import, and direct Lexical editing. This is a breaking replacement with no compatibility or migration layer. The schema identifier's website is not deployed by this change.

### Patch Changes

- Updated dependencies [4054023]
  - @opral/zettel-ast@1.1.0
  - @opral/zettel-html@1.1.0

## 0.0.1

### Patch Changes

- Updated dependencies [57e6245]
  - @opral/zettel-ast@0.2.0
  - @opral/zettel-html@0.1.1
