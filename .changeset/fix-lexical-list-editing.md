---
"@opral/zettel-lexical": patch
---

Make lists and quotes editable from the keyboard like other rich-text editors. Enter on an empty list item leaves the list (an empty nested item moves up a level) and Enter on an empty last line of a quote leaves the quote. Backspace at the start of a list item, empty or not, keeps its text: a nested item moves up a level and a top-level item becomes a paragraph. Backspace at the start of any quote line moves that line out of the quote, splitting the quote if needed. Neither merges the text into the previous item or leaves an empty bullet. Select all + Delete leaves one empty paragraph. Edits that merge blocks can no longer produce a document that `exportDocument` rejects: empty lists and items are removed, stray text inside list items and quotes is wrapped in a paragraph, and links moved into another block keep a link definition there.
