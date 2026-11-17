import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { githubJson, TICK_COALESCE_MS } from './github-read.svelte';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';

/**
 * Regression (home-incident /changes, /revisions, /dependencies never painted): `githubJson` bumped one reactive tick PER ANSWER, and every
 * derivation that had asked re-ran per answer. With 49 answers and a ~1 s page derivation that is a minute of frozen main thread.
 * A burst of answers must cost a bounded number of re-runs, independent of the number of answers.
 */
afterEach(() => { installLiveSource(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('githubJson answers arrive in a burst', () => {
	it('re-runs a reading derivation a bounded number of times, not once per answer', async () => {
		const N = 60;
		installLiveSource({ rollouts: [] } as never);
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
		let runs = 0;
		const stop = $effect.root(() => {
			$effect(() => {
				runs++;
				for (let i = 0; i < N; i++) githubJson(`/api/burst/${i}`);
			});
		});
		flushSync();
		expect(runs).toBe(1);
		/* every answer lands (microtasks), no timer has fired yet: nothing re-ran per answer */
		await vi.waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(N));
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(runs).toBe(1);
		await new Promise((r) => setTimeout(r, TICK_COALESCE_MS + 200));
		flushSync();
		expect(runs).toBe(2); /* ONE re-run for the whole burst, and the answers are all read */
		expect(githubJson('/api/burst/59')).toEqual({ ok: true });
		stop();
	});
});
