import { $getSelection, $setSelection, type RangeSelection } from "lexical";

/**
 * Run a Lexical edit of a non-collapsed selection with the live selection
 * detached.
 *
 * Lexical (through at least 0.51) throws "$getTextNodeOffset: invalid offset"
 * when a range that starts at the beginning of a block ends inside a text run
 * of a later block: it trims that text run, then merges the blocks while the
 * live selection still holds the untrimmed offset, so the key press does
 * nothing. The removal rebuilds the selection from its own carets, so it does
 * not need the live one; it is restored afterwards unless the edit set a new
 * one.
 */
function $editDetached(selection: RangeSelection, edit: () => void): void {
  const isCurrent = $getSelection() === selection;
  if (isCurrent) $setSelection(null);
  try {
    edit();
  } finally {
    if (isCurrent && $getSelection() === null) $setSelection(selection);
  }
}

/** `RangeSelection.removeText()` without the cross-block crash described above. */
export function $removeSelectedText(selection: RangeSelection): void {
  if (!selection.isCollapsed()) $editDetached(selection, () => selection.removeText());
}

/**
 * Delete like `RangeSelection.deleteCharacter()`. A range is removed (a
 * select-all range removes the blocks themselves) without the cross-block
 * crash described above.
 */
export function $deleteSelection(selection: RangeSelection, isBackward: boolean): void {
  if (selection.isCollapsed()) selection.deleteCharacter(isBackward);
  else $editDetached(selection, () => selection.deleteCharacter(isBackward));
}
