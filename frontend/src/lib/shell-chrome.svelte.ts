import { getContext, setContext, type Snippet } from 'svelte';

const KEY = Symbol('shell-chrome');

/**
 * ⭐ THE TAB STRIP LEAVES `<main>`'S SCROLL REGION ENTIRELY. (2026-09-05,
 * from the human: *"tabs are not fixed, so it looks weird when scrolling up
 * in Chrome; they can get separated from the main navbar."*)
 *
 * The strip used to be `sticky top-0` INSIDE `<main>`, the one scroller from
 * `sm` up — so Chrome's rubber-band bounce at the top of the scroll range
 * visibly detached it from the static navbar one level up. Moving it out of
 * `<main>` removes the scroller between them; there is nothing left to
 * desynchronize.
 *
 * A route that owns a secondary nav strip (today: rollout detail) publishes
 * it here as a snippet; the root layout renders it as a sibling of `Navbar`
 * inside the shell's `.header-group` (see `app.css`) — static chrome at
 * `sm`+, part of the auto-hiding group below `sm`. A route that publishes
 * nothing leaves `tabStrip` `null` and the slot renders nothing, exactly as
 * if it were never there — no empty box, no reserved height.
 */
export class ShellChrome {
	tabStrip = $state<Snippet | null>(null);
}

/** Called once, by the root layout, to create and provide the instance. */
export function provideShellChrome(): ShellChrome {
	const chrome = new ShellChrome();
	setContext(KEY, chrome);
	return chrome;
}

/** Called by any route layout that wants to publish chrome into the shell. */
export function getShellChrome(): ShellChrome {
	const chrome = getContext<ShellChrome>(KEY);
	if (!chrome) {
		throw new Error('getShellChrome() was called outside the root layout that provides it');
	}
	return chrome;
}
