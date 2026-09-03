import { describe, it, expect, vi, afterEach } from 'vitest';
import { connectGithub, connectGithubInNewTab } from './github';

/**
 * These live in a `.svelte.test.ts` file (jsdom, not the plain-node
 * workspace `github.test.ts` runs in) purely to get a `window` to assert
 * against — nothing here touches Svelte.
 *
 * "There's no way to login to GitHub on mobile" (2026-09-03): a popup from
 * `window.open()` is frequently blocked on a phone browser, silently, with
 * no error to catch — `connectGithubInNewTab` must fall back to the SAME
 * navigation `connectGithub` does whenever the caller looks like a phone
 * (narrow viewport OR a coarse/touch pointer), and must still do so from
 * an open dialog, where it used to always pop a new tab.
 */

function stubLocation(pathname: string, search = '') {
	const original = Object.getOwnPropertyDescriptor(window, 'location');
	let hrefSet: string | null = null;
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: {
			pathname,
			search,
			get href() {
				return hrefSet ?? `${pathname}${search}`;
			},
			set href(v: string) {
				hrefSet = v;
			}
		}
	});
	return {
		get href() {
			return hrefSet;
		},
		restore: () => {
			if (original) Object.defineProperty(window, 'location', original);
		}
	};
}

function stubMatchMedia({ narrow = false, coarse = false }: { narrow?: boolean; coarse?: boolean }) {
	vi.stubGlobal(
		'matchMedia',
		vi.fn((query: string) => ({
			matches: query.includes('max-width') ? narrow : query.includes('pointer: coarse') ? coarse : false
		}))
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('connectGithub', () => {
	it('navigates same-tab, carrying the current URL as return_to by default', () => {
		const loc = stubLocation('/rollouts/prod/dev/hello-world-app', '?tab=history');
		connectGithub();
		expect(loc.href).toBe(
			'/api/auth/github/login?return_to=%2Frollouts%2Fprod%2Fdev%2Fhello-world-app%3Ftab%3Dhistory'
		);
		loc.restore();
	});

	it('accepts an explicit return_to', () => {
		const loc = stubLocation('/apps/hello-world-app');
		connectGithub('/revisions/x');
		expect(loc.href).toBe('/api/auth/github/login?return_to=%2Frevisions%2Fx');
		loc.restore();
	});
});

describe('connectGithubInNewTab', () => {
	it('opens a new tab on desktop — fine pointer, wide viewport', () => {
		stubMatchMedia({ narrow: false, coarse: false });
		const openSpy = vi.fn();
		vi.stubGlobal('open', openSpy);
		const loc = stubLocation('/rollouts/prod/dev/hello-world-app');
		connectGithubInNewTab('/rollouts/prod/dev/hello-world-app');
		expect(openSpy).toHaveBeenCalledWith(
			'/api/auth/github/login?return_to=%2Frollouts%2Fprod%2Fdev%2Fhello-world-app',
			'_blank',
			'noopener,noreferrer'
		);
		expect(loc.href).toBeNull();
		loc.restore();
	});

	it('falls back to same-tab navigation on a narrow (phone) viewport, even from an open dialog', () => {
		stubMatchMedia({ narrow: true, coarse: false });
		const openSpy = vi.fn();
		vi.stubGlobal('open', openSpy);
		const loc = stubLocation('/rollouts/prod/dev/hello-world-app');
		connectGithubInNewTab('/rollouts/prod/dev/hello-world-app');
		expect(openSpy).not.toHaveBeenCalled();
		expect(loc.href).toBe(
			'/api/auth/github/login?return_to=%2Frollouts%2Fprod%2Fdev%2Fhello-world-app'
		);
		loc.restore();
	});

	it('falls back to same-tab navigation on a coarse (touch) pointer even at desktop width', () => {
		stubMatchMedia({ narrow: false, coarse: true });
		const openSpy = vi.fn();
		vi.stubGlobal('open', openSpy);
		const loc = stubLocation('/rollouts/prod/dev/hello-world-app');
		connectGithubInNewTab('/rollouts/prod/dev/hello-world-app');
		expect(openSpy).not.toHaveBeenCalled();
		expect(loc.href).not.toBeNull();
		loc.restore();
	});
});
