import { describe, test, expect, beforeEach } from 'vitest';
import { focusables, inertSiblings, trapFocus } from './a11y.svelte';
import { announce, liveMessages, resetAnnouncements } from './stores/announce.svelte';

/**
 * These cover the three mechanisms the 2026-08-30 keyboard audit added, and
 * each test is a defect that was MEASURED on the running app rather than
 * imagined:
 *
 *  - the command palette let Tab escape onto the page behind it;
 *  - closing an overlay dropped focus on `<body>` instead of its trigger;
 *  - the product had one `aria-live` region in the whole frontend.
 */

function mount(html: string): HTMLElement {
	document.body.innerHTML = html;
	return document.body.firstElementChild as HTMLElement;
}

describe('focusables', () => {
	beforeEach(() => (document.body.innerHTML = ''));

	test('collects focusable descendants in DOM order', () => {
		const root = mount(`
			<div>
				<a href="/one">one</a>
				<button>two</button>
				<input />
				<span>not focusable</span>
			</div>
		`);
		const names = focusables(root).map((el) => el.tagName);
		expect(names).toEqual(['A', 'BUTTON', 'INPUT']);
	});

	test('skips disabled controls, inert subtrees and aria-hidden', () => {
		const root = mount(`
			<div>
				<button disabled>disabled</button>
				<div inert><button>inside inert</button></div>
				<button aria-hidden="true">hidden</button>
			</div>
		`);
		expect(focusables(root)).toEqual([]);
	});

	test('keeps an element that is the active element even with no box', () => {
		const root = mount(`<div><button id="b">b</button></div>`);
		const b = root.querySelector('button') as HTMLButtonElement;
		b.focus();
		expect(focusables(root)).toContain(b);
	});
});

describe('inertSiblings', () => {
	beforeEach(() => (document.body.innerHTML = ''));

	test('marks every ancestor-sibling inert and restores exactly those on destroy', () => {
		document.body.innerHTML = `
			<div id="shell">
				<nav id="navbar"></nav>
				<div id="content"></div>
				<div id="overlay"></div>
			</div>
			<div id="outside"></div>
		`;
		const overlay = document.getElementById('overlay') as HTMLElement;
		const navbar = document.getElementById('navbar') as HTMLElement;
		const content = document.getElementById('content') as HTMLElement;
		const outside = document.getElementById('outside') as HTMLElement;

		const handle = inertSiblings(overlay);
		expect(navbar.inert).toBe(true);
		expect(content.inert).toBe(true);
		expect(outside.inert).toBe(true);
		// jsdom does not reflect `inert`, so an untouched element reads `undefined`.
		expect(overlay.inert).toBeFalsy();

		handle.destroy();
		expect(navbar.inert).toBe(false);
		expect(content.inert).toBe(false);
		expect(outside.inert).toBe(false);
	});

	test('leaves an already-inert element inert after destroy', () => {
		document.body.innerHTML = `
			<div id="shell"><div id="already"></div><div id="overlay"></div></div>
		`;
		const already = document.getElementById('already') as HTMLElement;
		already.inert = true;
		const handle = inertSiblings(document.getElementById('overlay') as HTMLElement);
		handle.destroy();
		expect(already.inert).toBe(true);
	});
});

describe('trapFocus', () => {
	beforeEach(() => (document.body.innerHTML = ''));

	test('Tab from the last control wraps to the first', () => {
		const root = mount(`<div><button id="first">a</button><button id="last">b</button></div>`);
		const first = document.getElementById('first') as HTMLButtonElement;
		const last = document.getElementById('last') as HTMLButtonElement;
		trapFocus(root);
		last.focus();
		const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
		last.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(first);
	});

	test('Shift+Tab from the first control wraps to the last', () => {
		const root = mount(`<div><button id="first">a</button><button id="last">b</button></div>`);
		const first = document.getElementById('first') as HTMLButtonElement;
		const last = document.getElementById('last') as HTMLButtonElement;
		trapFocus(root);
		first.focus();
		const ev = new KeyboardEvent('keydown', {
			key: 'Tab',
			shiftKey: true,
			bubbles: true,
			cancelable: true
		});
		first.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(last);
	});

	test('a key that is not Tab is left alone', () => {
		const root = mount(`<div><button id="first">a</button></div>`);
		const first = document.getElementById('first') as HTMLButtonElement;
		trapFocus(root);
		first.focus();
		const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		first.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(first);
	});
});

describe('announce', () => {
	beforeEach(() => resetAnnouncements());

	test('routes to the polite channel by default and leaves assertive empty', () => {
		announce('Copied version 0afab6f to the clipboard');
		expect(liveMessages.polite).toBe('Copied version 0afab6f to the clipboard');
		expect(liveMessages.assertive).toBe('');
	});

	test('a failure goes to the assertive channel', () => {
		announce('Could not copy', 'assertive');
		expect(liveMessages.assertive).toBe('Could not copy');
		expect(liveMessages.polite).toBe('');
	});

	test('repeating the same message still changes the node, so the region re-fires', () => {
		announce('deploy finished');
		const first = liveMessages.polite;
		announce('deploy finished');
		expect(liveMessages.polite).not.toBe(first);
		expect(liveMessages.polite.startsWith('deploy finished')).toBe(true);
	});

	test('an empty message is a no-op', () => {
		announce('something');
		announce('');
		expect(liveMessages.polite).toBe('something');
	});
});
