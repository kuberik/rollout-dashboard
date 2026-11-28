/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import ScheduleStatus from './ScheduleStatus.svelte';
import { NOT_BLOCKED } from '$lib/view-models/blocking-story';

afterEach(() => vi.unstubAllGlobals());
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** Banners system (2026-11-27): the banner line is ONE sentence, "Reopens in {t} — {clock}." The waiting count the line used to lead with
 *  (once `newerBuildsAre`, batch4 #19) is on the page already; it must not creep back in, in any count or pending state. */
describe('ScheduleStatus banner line is the reopening clock, with no waiting-count lead', () => {
	for (const [n, pending] of [[2, false], [1, false], [3, true]] as const) {
		test(`n=${n} pending=${pending}`, async () => {
			const next = new Date(Date.now() + 3 * 3600_000).toISOString();
			const sched = { metadata: { name: 'window' }, spec: { action: 'Allow', rules: [] }, status: { active: false, nextTransition: next } };
			vi.stubGlobal('fetch', vi.fn(async () => json({ rolloutSchedules: { items: [sched] }, clusterRolloutSchedules: { items: [] } })));
			const story = { ...NOT_BLOCKED, blocked: true, headline: 'Held', consequence: 'x', gates: [{ id: 'g' }], clock: [{ id: 'c' }], clearsAt: next, candidateCount: n, newerCount: n, countPending: pending } as any;
			const rollout = { metadata: { name: 'app', namespace: 'ns' }, spec: {}, status: { history: [] } } as any;
			const { container } = render(WithQueryClient, { props: { component: ScheduleStatus as any, props: { rollout, cluster: 'prod', story } } });
			await waitFor(() => expect(container.textContent).toMatch(/Reopens in .+ — /), { timeout: 5000 });
			expect(container.textContent).not.toMatch(/waiting\./);
			expect(container.textContent).not.toContain('Nothing promotes itself for another');
		});
	}
});
