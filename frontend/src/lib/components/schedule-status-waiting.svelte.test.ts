/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import ScheduleStatus from './ScheduleStatus.svelte';
import { NOT_BLOCKED, newerBuildsAre } from '$lib/view-models/blocking-story';

afterEach(() => vi.unstubAllGlobals());
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** batch4 #19 (QA29 M3b): ScheduleStatus's "N newer builds are waiting." must come from `newerBuildsAre`, not a second inline copy. */
describe('ScheduleStatus waiting sentence is newerBuildsAre', () => {
	for (const [n, pending] of [[2, false], [1, false], [3, true]] as const) {
		test(`n=${n} pending=${pending}`, async () => {
			const next = new Date(Date.now() + 3 * 3600_000).toISOString();
			const sched = { metadata: { name: 'window' }, spec: { action: 'Allow', rules: [] }, status: { active: false, nextTransition: next } };
			vi.stubGlobal('fetch', vi.fn(async () => json({ rolloutSchedules: { items: [sched] }, clusterRolloutSchedules: { items: [] } })));
			const story = { ...NOT_BLOCKED, blocked: true, headline: 'Held', consequence: 'x', gates: [{ id: 'g' }], clock: [{ id: 'c' }], clearsAt: next, candidateCount: n, newerCount: n, countPending: pending } as any;
			const rollout = { metadata: { name: 'app', namespace: 'ns' }, spec: {}, status: { history: [] } } as any;
			const { container } = render(WithQueryClient, { props: { component: ScheduleStatus as any, props: { rollout, cluster: 'prod', story } } });
			await waitFor(() => expect(container.textContent).toContain(`${newerBuildsAre(n, pending)} waiting. Nothing promotes itself`), { timeout: 5000 });
		});
	}
});
