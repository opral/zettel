---
"@opral/zettel-lexical": major
---

Require Lexical 0.51. The `lexical` peer dependency is now `^0.51.0` (was `^0.30.0`), and `@lexical/history`, `@lexical/utils` and the new `@lexical/extension` dependency are 0.51. Apps must upgrade `lexical` to 0.51 together with this release.

Editing behavior is kept across the upgrade:

- Deleting, typing, Enter, paste or cut over a range that starts at the beginning of a block and ends inside a text run of a later block now works. Lexical threw (`$getTextNodeOffset: invalid offset`) and the key press did nothing; it still does in 0.51, so Zettel removes such ranges through a guarded path. `$removeSelectedText(selection)` is exported for apps that remove selected text themselves.
- A triple click selects only its block again, so typing over it no longer merges the next block (Lexical 0.45 moved this correction out of core).
- Select-all delete leaves an ordinary Zettel text block with a stable key that Enter can split (Lexical 0.50 leaves a plain `ParagraphNode`).
- Bold, italic and the other formats toggle off a range whose characters all have them, also when the range was selected in code (Lexical 0.47 toggles by the selection's cached format).
- Lexical JSON with plain `paragraph` and `text` nodes loads again through `fromLexicalState` (Zettel nodes now have zero-argument constructors, which Lexical 0.49+ requires).
