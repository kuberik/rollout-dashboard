/**
 * How far a scrolling pane must scroll so that `field` is whole inside it and clear of the bottom fade, or 0 when it already is. The pane is
 * scrolled, never the field (scrolling the element itself also moves every scrollable ancestor, which painted a half-clipped value in the Deploy
 * dialog). `fade` is the height of the "more below" gradient laid over the pane's bottom edge; `margin` is the room kept past it.
 */
export function paneScrollDelta(pane: { top: number; bottom: number }, field: { top: number; bottom: number }, fade = 24, margin = 8): number {
	const clearBottom = pane.bottom - fade;
	if (field.bottom > clearBottom) return field.bottom - clearBottom + margin;
	if (field.top < pane.top) return field.top - pane.top - margin;
	return 0;
}

/** The nearest ancestor that scrolls vertically (the dialog's pane on desktop, the sheet's scrolling area on a phone), or null. */
export function scrollPaneOf(el: HTMLElement): HTMLElement | null {
	for (let p = el.parentElement; p; p = p.parentElement) {
		const oy = getComputedStyle(p).overflowY;
		if (oy === 'auto' || oy === 'scroll') return p;
	}
	return null;
}
