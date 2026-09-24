---
"@opral/zettel-lexical": patch
---

Keep links when blocks are joined: Backspace at the start of a block, Delete at the end of one, or deleting a range across blocks moved the joined block's linked spans without their link definitions, so the links were lost and `exportDocument` threw `Unresolved mark`. The moved spans now get a definition in their new block (reusing one with the same href), and a mark that cannot be resolved is dropped instead of breaking the document.
