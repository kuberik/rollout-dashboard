import { describe, it, expect } from 'vitest';
import { load } from './+page';

const run = (qs: string) => { try { load({ url: new URL(`https://x.test/rollouts${qs}`) }); return null; } catch (e) { const r = e as { status?: number; location?: string }; return { status: r.status, location: r.location }; } };

describe('/rollouts?state=', () => {
	it('state words that are groups of the list are a filter now: no redirect', () => {
		for (const w of ['progress', 'waiting', 'held', 'rest', 'held,rest']) expect(run(`?state=${w}`)).toBeNull();
		expect(run('')).toBeNull();
		expect(run('?q=a&env=prod')).toBeNull();
	});
	it('failing still lands on #attention, other words and params kept', () => {
		expect(run('?state=failing')).toEqual({ status: 307, location: '/rollouts#attention' });
		expect(run('?state=failing,held&env=prod')).toEqual({ status: 307, location: '/rollouts?state=held&env=prod#attention' });
	});
});
