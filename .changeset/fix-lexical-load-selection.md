---
"@opral/zettel-lexical": patch
---

Keep the caret in a Zettel block after `loadDocument` replaces the document under it (for example when a comment box clears itself after sending). Typing afterwards no longer creates a stray Lexical paragraph without Zettel classes, in which Shift+Enter made new paragraphs instead of hard breaks. Typing into a document without blocks creates a Zettel text block.
