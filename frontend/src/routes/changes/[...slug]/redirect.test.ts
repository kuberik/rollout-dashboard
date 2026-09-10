import { describe, expect, it } from 'vitest';

/**
 * `+page.ts`'s own host-less-slug redirect — FIX PASS ITEM 3 (2026-09-10).
 * See that file's doc comment for the rule and the bug it closes (⌘K's
 * palette rows landing on `/changes/littlechimera/kuberik-testing/bf5be49`,
 * a host-less path `+page.svelte` rejects as "This repository does not
 * exist").
 */
import { load } from './+page';

function paramsFor(slug: string) {
	return { params: { slug } } as unknown as Parameters<typeof load>[0];
}

function redirectedTo(slug: string): string | null {
	try {
		load(paramsFor(slug));
		return null;
	} catch (e) {
		// `@sveltejs/kit`'s `redirect()` throws a `Redirect` object with
		// `status`/`location` — inspected structurally so this test does not
		// depend on importing SvelteKit's own (non-exported) class.
		return (e as { location?: string }).location ?? null;
	}
}

describe('/changes/[...slug] +page.ts — host-less redirect', () => {
	it('308s a host-less owner/repo/sha to the canonical github.com address', () => {
		expect(redirectedTo('littlechimera/kuberik-testing/bf5be49')).toBe(
			'/changes/github.com/littlechimera/kuberik-testing/bf5be49'
		);
	});

	it('308s a host-less owner/repo/pull/n to the canonical github.com address', () => {
		expect(redirectedTo('littlechimera/kuberik-testing/pull/4')).toBe(
			'/changes/github.com/littlechimera/kuberik-testing/pull/4'
		);
	});

	it('does not redirect a slug that already names github.com', () => {
		expect(redirectedTo('github.com/littlechimera/kuberik-testing/bf5be49')).toBeNull();
	});

	it('does not redirect a slug naming another host', () => {
		expect(redirectedTo('gitlab.example.com/acme/widget/bf5be49')).toBeNull();
	});

	it('does not redirect a 2-segment app-fallback build page (no linked repo)', () => {
		expect(redirectedTo('hello-frontend-app/9f10e49')).toBeNull();
	});

	it('does not redirect a bare 1-segment repository page', () => {
		expect(redirectedTo('hello-frontend-app')).toBeNull();
	});
});
