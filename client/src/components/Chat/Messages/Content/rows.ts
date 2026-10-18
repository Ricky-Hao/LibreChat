/**
 * A tool row starts at 20px with 6px margins above and below, shared by call
 * card headers and the streaming cursor beneath a collapsed phase. Wrapped
 * intents and metadata can grow the row without overlapping the next card.
 */
export const TOOL_ROW_CLASSES = 'relative my-1.5 flex min-h-5 shrink-0 items-center gap-2.5';

/** Behavior hook for header glyphs, independent of their layout. */
export const FOLD_GLYPH_CLASS = 'fold-glyph';

/**
 * The leading glyph slot of a row: 24px wide, the width of the message
 * header's avatar, and the row's own 20px tall. A 16px tool icon, the 14px
 * phase check and the 12px cursor dot all center in it, so every row's glyph
 * sits on the avatar's axis, and with the row's 8px gap every row's text
 * starts where the header's name does. `min-w` rather than `w`, so a stacked
 * icon strip can run wider without overlapping its label. The slot stays on
 * the first line when a tool row wraps. `fold-glyph` is a
 * hook, not a style: see `FOLD_GLYPH_SELECTOR`.
 */
export const ROW_GLYPH_SLOT = `${FOLD_GLYPH_CLASS} flex h-5 min-w-6 shrink-0 items-center justify-center`;

/** Shared by normal row slots and custom header glyphs. */
export const FOLD_GLYPH_SELECTOR = `.${FOLD_GLYPH_CLASS}`;

/**
 * The panel under an open header: its rows step in by one glyph slot and a
 * hairline (`FoldRail`) hangs from the header's glyph down their left, so what
 * is under the header reads as under it. Carried by the panel's clipping
 * wrapper, the one `overflow-hidden` element the fold animation needs: the
 * inset then lies INSIDE the clip, which is what lets a failed row's stripe,
 * drawn 12px left of the row, show at all. The rail is absolutely positioned
 * in that inset, out of flow, so the height animation is untouched.
 */
export const FOLD_RAIL_CLASSES = 'relative pl-6';

/**
 * A copy action laid over its pane (`group/copy`) instead of beside it, so it
 * takes no width from the content. Hidden until the pane is hovered or the
 * action holds keyboard focus; touch input, which cannot hover, always sees it.
 */
export const PANE_COPY_REVEAL =
  '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:group-hover/copy:opacity-100';
