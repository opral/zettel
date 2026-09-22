# Comment flow verification — 2026-09-21

Zettel format commit: `2e4c436128a1854a48fb84696d272f0978171fcd`.
Sibling Lix checkout: `d2823d93f390fc2f803c48472b157bb16939efb2`.
Native artifact SHA-256 (`packages/js-sdk/lix_js_sdk.node`): `fe44130e46d3cb63f6735e1c6405dbda3d9ec32030a2f26859b6274c016c793c`.

## Results

6 model scenario groups passed:

1. Conversations address actual commit and test paragraph/CSV rows via `lix_row_ref`.
2. Missing conversation/account FKs and invalid body writes are rejected without adding comments.
3. Edited bodies, keys, FKs, and target refs survive snapshot close/reopen. Updating paragraph text, CSV data, and row positions retains target refs.
4. Divergent edits to the same comment body select the incoming source body in full.
5. Edits to different comments both survive a real branch merge; target refs stay unchanged.
6. Merged data survives another durable close/reopen.

5 browser scenario groups passed:

1–3. For each of checkpoint, paragraph, and CSV: GFM import → actual Lexical keyboard input → JSONB save → page reload → edit the same comment ID → GFM export. Body equality is checked exactly, including node keys, across persistence; Markdown equality uses canonical serialization because import generates new node keys.

4. Full server shutdown/restart retains all saved comment bodies and targets.

5. Mobile viewport has no horizontal overflow; no uncaught page errors occurred. Desktop/mobile screenshots were captured and the desktop rendering inspected.

## LWW observation

The test deliberately edits the source branch first, then edits the target branch, then merges source into target. The source body wins. Lix's native reconciliation describes LWW in terms of publication order: incoming accepted values replace competing current values. This must **not** be described as selecting the comment with the latest wall-clock `created_at` or edit timestamp.

The unit is the JSONB **column**. Different paragraphs inside the same body do not merge independently. Both edits to different comment rows survive. No custom merger, unresolved-conflict API, or text-level reconciliation is involved.

## Boundaries

The account, Markdown paragraph, and CSV row tables are registered prototype schemas. This does not verify production account integration, file-plugin import/export, automatic paragraph identity across external file rewrites, deletion policy, authentication, or multi-replica network synchronization. The branch tests use the real engine locally. No new rich-text nodes were needed to complete these flows.

## Empty-composer regression

A user reported that direct typing into the untouched composer did nothing. The earlier browser checks all imported Markdown first and missed this path. A new browser test reproduced a timeout before the fix. The composer now initializes an empty paragraph, and the Lexical plugin handles `CONTROLLED_TEXT_INSERTION_COMMAND`, which is required when there is no existing text node to mutate. Empty Markdown imports also produce an editable paragraph; blank drafts are rejected on save.

After the fix, all 6 model groups and 6 browser groups pass, including fresh typing and typing after save/reset. All 22 Lexical tests pass, including a controlled-insertion regression with Unicode text. Stored empty-document semantics remain unchanged.
