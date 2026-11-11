import { describe, it, expect, vi } from 'vitest';

const norel = vi.hoisted(() => ({ app: '' }));
vi.mock('$lib/releases/registry.svelte', async (orig) => {
	const m = await orig<typeof import('$lib/releases/registry.svelte')>();
	return {
		...m,
		noReleasesOf: (r: { metadata?: { name?: string } } | null) =>
			norel.app && r?.metadata?.name === norel.app
				? { kind: 'empty', label: 'No releases yet', message: '' }
				: m.noReleasesOf(r as never)
	};
});
import { inbound, TIERS } from './data';

/* no release = not affected: an app with no releases in a tier is never an inbound build there ("N builds arriving" on /environments) */
describe('inbound skips places without releases', () => {
	it('drops an app whose place has no releases, keeps the rest', () => {
		norel.app = '';
		const all = TIERS.flatMap((t) => inbound('incident', t).map((x) => `${t}/${x.app}`));
		expect(all.length).toBeGreaterThan(0);
		const victim = all[0].split('/')[1];
		norel.app = victim;
		const after = TIERS.flatMap((t) => inbound('incident', t).map((x) => `${t}/${x.app}`));
		expect(after.some((k) => k.endsWith(`/${victim}`))).toBe(false);
		expect(after).toEqual(all.filter((k) => !k.endsWith(`/${victim}`)));
		norel.app = '';
	});
});
