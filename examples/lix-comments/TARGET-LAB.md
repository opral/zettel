# Real-file comment target experiments

28 experiments using the current SDK's compiled `plugin_markdown` and `plugin_csv` archives. This is real SQL/Wasm execution, not a mock parser or hand-maintained row projection. The first complete run took 21.1 seconds. Archive SHA-256 hashes and every original/remaining row ID are recorded in [target-lab-results.json](./target-lab-results.json). The sibling Lix checkout was at `d2823d93f390fc2f803c48472b157bb16939efb2`; the archive hashes, rather than the checkout commit alone, identify the tested plugins.

## Method

Import `guide.md` and `budget.csv` through `lix_file`, install the bundled plugin archives, query real `markdown_node` / `csv_row` projections, and attach actual conversation/comment rows using `lix_row_ref`. Create a real checkpoint and attach a conversation and comment to it as well. Each scenario starts from the same independent baseline snapshot. After changing data, inspect actual serialized file bytes and row identities, export a snapshot, close/reopen Lix, and query the original content with `lix_as_of` at the checkpoint.

The target is `Ship on Monday.` in Markdown and `Design,100` in CSV. CSV's first record is data, not an inferred header. SQL updates are scoped by file ID and row UUID. File writes go through the plugin, which must reconcile identities.

## Observed results

| Change | Markdown | CSV |
| --- | --- | --- |
| SQL content edit | Same target ID; changed text | Same target ID; changed cells |
| SQL reorder | Same target ID; moved in actual file | Same target ID; moved in actual file |
| File content edit | Same ID | Same ID |
| File insertion before target | Same ID | Same ID |
| File reorder | Same ID follows content | Same ID follows content |
| File reorder and edit together | Same ID follows edited content | Same ID follows edited cells |
| Delete target | Target absent, comment retained | Target absent, comment retained |
| Delete, then reinsert identical content in a separate write | New ID; old comment stays detached | New ID; old comment stays detached |
| Duplicate target | Original ID retained on one copy; intent ambiguous | Original ID retained on one copy; intent ambiguous |
| Duplicate, then edit original position | Original target follows edited content | Original target follows edited cells |
| Replace with unrelated content in one write | Old ID now addresses replacement | Old ID now addresses replacement |
| Rename file | Same target ID | Same target ID |
| Branch edit, then merge | Same target ID and edited content | Same target ID and edited cells |
| Split paragraph | Old ID retained on first fragment (`Ship on`) | Not applicable |
| Merge target with next paragraph | Old ID retained on combined paragraph | Not applicable |

All 28 retained their comment, unchanged conversation reference, checkpoint and checkpoint comment. Live target resolution was identical after reopening. Historical lookup returned the original target content in every case. No experiment raised an execution error.

Of 24 cases with a declared semantic expectation, 22 met it. Two unrelated-replacement cases did not meet the deliberately conservative expectation that replacing an entity should detach the old comment. Four duplication/split/merge cases have no automatic semantic pass/fail judgment. These are identity-policy findings, not a claim that the plugins violated a documented contract.

## Implications for commenting

1. **Keep row refs for generic targets.** Ordinary edits and moves work in these cases without adding anything to Zettel bodies.
2. **Prefer row-ID-preserving SQL edits in structured editors.** These express which entity the user is editing. Raw file writes require identity inference, even when they happen to produce the same bytes.
3. **Render missing targets explicitly.** Keep the conversation and offer history/context; do not silently reattach by matching text. Delete/reinsert already behaves conservatively in this experiment.
4. **Decide the replacement/split policy.** A stable row ID does not prove that a comment still concerns the same subject. A one-write replacement and delete-then-reinsert produce different attachment behavior. An editor could expose explicit “replace entity” as delete/create when that is the intended operation.
5. **Use history for original context.** The experiment retains a checkpoint solely to demonstrate history lookup. It does not propose a revision field on every target. Product integration still needs to choose which creation/history point to display.

## Prototype scope

The lab is separate from the existing composer so existing user comments and fixture targets remain intact. Its scenario runner installs real plugins and creates real comments in disposable Lix databases; the browser lets you inspect bytes, IDs, attachment status, and history results, and rerun the experiment set. It does not yet provide a general-purpose Markdown/CSV editor.

This is a small, deterministic scenario matrix, not a statistical reliability rate. No guarantees are established for every duplicate arrangement, structural edit, cross-file move, concurrent deletion, external filesystem synchronization, or plugin upgrade. The branch case edits the target on one branch; it is not a conflicting-target merge test. File edits are whole-file SQL writes, not a dedicated byte-range edit API. The test suite enforces infrastructure/persistence invariants but records semantic mismatches rather than hiding them behind passing test counts.
