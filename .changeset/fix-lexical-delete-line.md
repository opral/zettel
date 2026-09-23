---
"@opral/zettel-lexical": patch
---

Handle line deletion: Cmd+Backspace and Cmd+Delete on macOS (and the matching `deleteSoftLine*`/`deleteHardLine*` input types) now delete to the line boundary instead of doing nothing.
