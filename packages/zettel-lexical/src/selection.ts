import { $getSelection, $setSelection, type RangeSelection } from "lexical";

/**
 * Run a Lexical edit of `selection`. For a range, the live selection is
 * detached while the edit runs.
 *
 * Lexical (through at least 0.51) throws "$getTextNodeOffset: invalid offset"
 * when a range that starts at the beginning of a block ends inside a text run
 * of a later block: it trims that text run, then merges the blocks while the
 * live selection still holds the untrimmed offset, so the key press does
 * nothing. The removal rebuilds the selection from its own carets, so it does
 * not need the live one. The selection is restored afterwards unless the edit
 * set a new one.
 */
export function $editRange(selection: RangeSelection, edit: () => void): void {
  const isCurrent = !selection.isCollapsed() && $getSelection() === selection;
  if (isCurrent) $setSelection(null);
  try {
    edit();
  } finally {
    if (isCurrent && $getSelection() === null) $setSelection(selection);
  }
}

/** `RangeSelection.removeText()` without the cross-block crash described at {@link $editRange}. */
export function $removeSelectedText(selection: RangeSelection): void {
  $editRange(selection, () => selection.removeText());
}
