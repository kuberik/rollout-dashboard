/**
 * ⭐ THE KEYBOARD CONTRACT — the four things every overlay in this product owes
 * a person who is not holding a mouse.
 *
 * Nothing here is a style. Every function is a fix for something that was
 * measured by actually tabbing the running app on 2026-08-30:
 *
 * 1. `modalFocusReturn` — `ChangeVersionModal` closed with focus on `<body>`,
 *    not on the `Change Version` button that opened it. A keyboard user who
 *    opened the picker, changed their mind and pressed Escape was returned to
 *    the top of the document and had to tab past the whole navbar, the whole
 *    sidebar, the tab strip and the pipeline to get back to where they were.
 *    Native `<dialog>` restores focus on `close()`; this product's dialogs live
 *    inside `{#if open}`, so the element is destroyed and the restore is lost.
 *
 * 2. `inertSiblings` — the command palette is a plain `<div role="dialog">`,
 *    not a `<dialog>`, so nothing made the page behind it inert. Measured:
 *    fifteen Tab presses inside the palette and the sixteenth landed on the
 *    sidebar's `Home` link, with the palette still open and covering it.
 *
 * 3. `trapFocus` — the belt to `inertSiblings`' braces, and the thing that
 *    makes Shift+Tab off the first element wrap to the last rather than
 *    escaping into browser chrome.
 *
 * The three flowbite `Modal`s do NOT need 2 or 3: they render a native
 * `<dialog>` opened with `showModal()`, which was verified to trap focus and to
 * make the rest of the document inert on its own. They needed 1, and they
 * needed a name.
 */

/** Elements that can take focus, in DOM order, excluding anything hidden. */
export function focusables(root: HTMLElement): HTMLElement[] {
	const sel =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"])';
	return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((el) => {
		if (el.hasAttribute('inert') || el.closest('[inert]')) return false;
		if (el.getAttribute('aria-hidden') === 'true') return false;
		// `checkVisibility` covers `display:none`, `visibility:hidden`,
		// `content-visibility` and the `hidden` attribute in one call. It is
		// deliberately NOT a `getBoundingClientRect()` size test: jsdom gives
		// every element a zero rect, so a size test makes this function return
		// nothing at all under vitest and silently untestable.
		if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
		return true;
	});
}

/**
 * Svelte action. Marks every ancestor-sibling of `node` `inert`, so a screen
 * reader and the Tab key both stop at the overlay. Undone on destroy, and only
 * for the elements this call actually changed — an element that was already
 * inert stays inert.
 */
export function inertSiblings(node: HTMLElement) {
	const touched: HTMLElement[] = [];
	let cur: HTMLElement | null = node;
	while (cur && cur !== document.body && cur.parentElement) {
		for (const sib of Array.from(cur.parentElement.children)) {
			if (sib === cur || !(sib instanceof HTMLElement)) continue;
			if (sib.inert) continue;
			sib.inert = true;
			touched.push(sib);
		}
		cur = cur.parentElement;
	}
	return {
		destroy() {
			for (const el of touched) el.inert = false;
		}
	};
}

/** Svelte action. Cycles Tab / Shift+Tab inside `node`. */
export function trapFocus(node: HTMLElement) {
	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const items = focusables(node);
		if (items.length === 0) {
			e.preventDefault();
			node.focus();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement as HTMLElement | null;
		if (e.shiftKey && (active === first || !node.contains(active))) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (active === last || !node.contains(active))) {
			e.preventDefault();
			first.focus();
		}
	}
	node.addEventListener('keydown', onKeydown);
	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
		}
	};
}

/**
 * Svelte action. Moves `node` to be a direct child of `document.body` on
 * mount. `CommandPalette`'s `fixed inset-0` overlay is written inside
 * `Navbar`, which the root layout renders inside `.header-group` — a
 * `position: fixed` element that ALSO carries `transform`/`will-change:
 * transform` below `sm` (the hide-on-scroll unit, `app.css`). A `transform`
 * on an ancestor makes it the containing block for its `fixed` descendants
 * per spec, so at 390 the palette wasn't full-viewport at all: it was
 * positioned against `.header-group`'s own ~53px box, landing the search
 * input at `top:-4px` and the close button at `top:-8px`, both off the
 * clickable area. Measured 2026-09-10.
 *
 * Fixing `.header-group` to stop transforming was rejected: the slide is the
 * shipped hide-on-scroll behaviour (2026-09-05), and ANY future fixed overlay
 * mounted under `Navbar` would hit the same bug again. Moving the node's
 * real DOM position to `document.body` escapes every transformed ancestor at
 * once, for this overlay and any later one — it is a DOM relocation, not a
 * component reparent, so `bind:open`/`bind:scope` and the rest of Svelte's
 * reactivity are untouched. Run this action BEFORE `inertSiblings` on the
 * same element (action order = attribute order) so the sibling walk starts
 * from the node's new, correct position under `<body>`.
 */
export function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		}
	};
}

/**
 * Call once at component init with a getter for the overlay's `open` state.
 * Remembers what had focus the instant before the overlay opened (via
 * `$effect.pre`, which runs before the DOM is patched, so the trigger is still
 * `document.activeElement`) and puts focus back there when it closes.
 */
export function modalFocusReturn(isOpen: () => boolean) {
	let lastFocused: HTMLElement | null = null;

	$effect.pre(() => {
		if (isOpen() && !lastFocused) {
			const el = document.activeElement;
			lastFocused = el instanceof HTMLElement && el !== document.body ? el : null;
		}
	});

	$effect(() => {
		if (isOpen()) return;
		const el = lastFocused;
		if (!el) return;
		lastFocused = null;
		// ⚠️ TIMING, MEASURED. A single `setTimeout(0)` is NOT enough and was
		// verified not to work: the overlay is still transitioning out (100ms),
		// and its teardown calls `dialog.close()`, which blanks focus to
		// `<body>` AFTER we have restored it. So restore immediately, then
		// re-check past the transition and restore again if something took it.
		const restore = () => {
			if (el.isConnected && document.activeElement !== el) el.focus();
		};
		restore();
		setTimeout(restore, 0);
		setTimeout(restore, 180);
	});
}
