import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { rollouts } from './data';
import Slipway from './Slipway.svelte';

const S = 'incident' as const;
const rowOf = (app: string, tier: string) => rollouts(S).rows.find((r) => r.app === app && r.tier === tier && r.group === 'approval')!;

/* The Slipway pane (open under a place on /apps, /envs and the rollout list) reads the same clock: its time slot prints the wait, never the waiting build's age. */
describe('Slipway pane time on a waiting place', () => {
	for (const [app, WAIT] of [['telemetry-indexer', '42m'], ['invoice-api', '4h']] as const) {
		it(`${app} prod: the pane says ${WAIT}`, () => {
			const row = rowOf(app, 'prod');
			const { container } = render(Slipway, { row, hs: S });
			const times = [...container.querySelectorAll('span.t-meta.tabular-nums')].map((e) => e.textContent?.trim());
			expect(times).toContain(WAIT);
		});
	}
});
