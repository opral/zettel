# Lix comment application profile

The body JSONB cell stores a Zettel v1 envelope `{format:'zettel',version:1,blocks:[...]}`. Comment/conversation IDs, author, time, and conversation target are columns outside that body.

- `zettel_demo_comment.conversation_id`: ordinary FK to the conversation table.
- `zettel_demo_comment.author_id`: ordinary FK to `lix_account.id`.
- Conversation `target`: opaque RowRef, here stored as text, addressing a commit, file, or any supported relation. This is not a generic FK.
- Inline mention: `{_type:'lix_ref',_key,target:RowRef,label:string}`. The label remains when a target is unavailable. No revision selector or inline formatting marks; text can be split around the atom.
- Attachment: `{_type:'lix_attachment',_key,file_id:string,display:'file'|'image',alt?:string,caption?:string}`. `file_id` is a file UUID, not a RowRef. Bytes live in `lix_file.content`, outside the document. An ID inside JSON does not become a database FK.

All extension objects are closed. `profile.mjs` checks shapes through the core's explicit extension callbacks. Its RowRef prefix check is not an authenticity, existence, resolution, or authorization check. References inserted by the UI are obtained from Lix constructors; an arbitrary JSON author can supply an unresolved value. The app stores that value, not proof of target existence.

Markdown conventions for this demo:

```md
[checkpoint](lix://row/<percent-encoded-full-RowRef>)

[notes.txt](lix://file/<file-UUID>)

![Preview](lix://file/<file-UUID> "Optional caption")
```

A file/image attachment must occupy its own paragraph. Ordinary external images are rejected until uploaded as Lix assets. Markdown import allocates fresh keys; using the JSON authoring tab preserves supplied identities. Strict export rejects a value it cannot preserve, including underline, empty paragraphs, or file attachments whose alternative text would be lost.

The demo is a local single-account sandbox. Whole-body updates use the ordinary database behavior; no custom merger, live collaboration service, permissions system, or notification delivery is installed. The tested engine's FK deletion limitation is documented in README; this app exposes no deletion route.

In this prototype, conversation/comment rows use global scope so the pinned engine can resolve the FK to its globally stored account. Assets and the checkpoint use main. This scope workaround does not establish production branch or merge semantics.
