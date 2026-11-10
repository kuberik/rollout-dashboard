import { describe, it, expect } from 'vitest';
import { isSafeDemoPagePath, demoRedirectTarget } from './page-param';

const at = (search: string) => new URL(`https://kuberik.com/demo/${search}`);

describe('isSafeDemoPagePath', () => {
	it('accepts an ordinary app path', () => {
		expect(isSafeDemoPagePath('/')).toBe(true);
		expect(isSafeDemoPagePath('/rollouts/dev/default/hello-world')).toBe(true);
		expect(isSafeDemoPagePath('/activity?range=1d')).toBe(true);
		expect(isSafeDemoPagePath('/rollouts/prod/ns/name/dependencies')).toBe(true);
	});

	/**
	 * ⛔ THE OPEN REDIRECT. Each of these is a path to `String.startsWith('/')`
	 * and an ORIGIN to the browser's URL parser. That gap is the whole bug.
	 */
	it('rejects a protocol-relative URL dressed as a path', () => {
		expect(isSafeDemoPagePath('//evil.com')).toBe(false);
		expect(isSafeDemoPagePath('//evil.com/rollouts')).toBe(false);
		expect(isSafeDemoPagePath('///evil.com')).toBe(false);
	});

	it('rejects a backslash after the leading slash', () => {
		// Several URL parsers normalise `\` to `/`, which turns this back into
		// the protocol-relative case above.
		expect(isSafeDemoPagePath('/\\evil.com')).toBe(false);
		expect(isSafeDemoPagePath('/\\/evil.com')).toBe(false);
	});

	it('rejects anything that is not rooted at a single slash', () => {
		expect(isSafeDemoPagePath('https://evil.com')).toBe(false);
		expect(isSafeDemoPagePath('rollouts')).toBe(false);
		expect(isSafeDemoPagePath('')).toBe(false);
		expect(isSafeDemoPagePath(null)).toBe(false);
		expect(isSafeDemoPagePath('javascript:alert(1)')).toBe(false);
	});

	/**
	 * `..` cannot leave the ORIGIN, but it can leave the BASE — `/demo/..` is
	 * the marketing site with a half-booted dashboard behind it — and no
	 * legitimate showcase link contains one.
	 */
	it('rejects a .. segment anywhere in the path', () => {
		expect(isSafeDemoPagePath('/..')).toBe(false);
		expect(isSafeDemoPagePath('/../')).toBe(false);
		expect(isSafeDemoPagePath('/../evil')).toBe(false);
		expect(isSafeDemoPagePath('/rollouts/../..')).toBe(false);
		expect(isSafeDemoPagePath('/rollouts/..?tab=history')).toBe(false);
	});

	/** A path that merely CONTAINS the characters is fine — only a whole segment counts. */
	it('does not reject a legitimate path with dots in a segment', () => {
		expect(isSafeDemoPagePath('/apps/v1..2')).toBe(true);
		expect(isSafeDemoPagePath('/rollouts/dev/default/hello..world')).toBe(true);
		expect(isSafeDemoPagePath('/versions/1.2.3')).toBe(true);
	});
});

describe('demoRedirectTarget', () => {
	it('prefixes the base', () => {
		expect(demoRedirectTarget(at('?page=/rollouts/dev/default/hello-world'), '/demo')).toBe(
			'/demo/rollouts/dev/default/hello-world'
		);
	});

	it('is null with no page param, so the load falls through to Home', () => {
		expect(demoRedirectTarget(at(''), '/demo')).toBe(null);
		expect(demoRedirectTarget(at('?theme=light'), '/demo')).toBe(null);
	});

	it('is null for an off-site page param, with or without a base', () => {
		expect(demoRedirectTarget(at('?page=//evil.com'), '/demo')).toBe(null);
		// ⛔ THE CASE A NON-EMPTY BASE WAS ACCIDENTALLY MASKING: without a base
		// the naive version produced `//evil.com`, a live off-site redirect.
		expect(demoRedirectTarget(at('?page=//evil.com'), '')).toBe(null);
	});

	it('cannot loop: the target it returns carries no page param', () => {
		const first = demoRedirectTarget(at('?page=/activity'), '/demo');
		expect(first).toBe('/demo/activity');
		expect(demoRedirectTarget(new URL(`https://kuberik.com${first}`), '/demo')).toBe(null);
	});
});
