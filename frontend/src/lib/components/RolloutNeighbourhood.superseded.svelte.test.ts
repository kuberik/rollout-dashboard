import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import RolloutNeighbourhood from './RolloutNeighbourhood.svelte';
import type { GraphNode } from '$lib/view-models/dependency-graph';
import type { RolloutNeighbourhood as Hood } from '$lib/view-models/rollout-neighbourhood';
import type { GateBox } from '$lib/view-models/rollout-gates';

/**
 * Batch 4 (b+): a gate is drawn once. The first frame draws a hold no box claims under the gate's own name (the schedules have not loaded);
 * when the schedule arrives its box claims the same gate under its window's name. The retained first-frame box must not stay beside it
 * ("After Hours · Holding dl-2" AND "Schedule gate dl1xx · Nothing held"): superseded by typed identity (`GateBox.gates`), never by title.
 */
const focus: GraphNode = { id: 'c/ns/door-lock', cluster: 'c', namespace: 'ns', name: 'door-lock', env: 'prod', envRank: 0, unresolved: false, build: 'dl-1', candidateCount: 1, waiting: true, blocked: true, holds: [] };
const box = (o: Partial<GateBox> & Pick<GateBox, 'key' | 'title' | 'kind'>): GateBox => ({ state: 'blocked', kindWord: null, phrase: 'holding dl-2', held: ['dl-2'], mark: { kind: 'schedule', clears: 'clock' }, gates: [], ...o });
const hood = (gates: GateBox[]): Hood => ({ focus, upstream: [], downstream: [], gates, heldLinks: 0, total: gates.length, holding: gates.length, heldBuilds: ['dl-2'] });
const titles = (c: HTMLElement) => [...c.querySelectorAll('[data-hood-link="upstream"]')].map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim());

describe('RolloutNeighbourhood: a retained gate box superseded by the box that now claims its gate', () => {
	test('the first-frame box and the schedule box for the same gate draw once, under the window name', async () => {
		const first = box({ key: 'gate:schedule-gate-dl1xx', title: 'Schedule gate dl1xx', kind: 'gate', gates: ['schedule-gate-dl1xx'] });
		const win = box({ key: 'schedule:ns/after-hours', title: 'After Hours', kind: 'schedule', kindWord: 'Deploy window', gates: ['schedule-gate-dl1xx'] });
		const { container, rerender } = render(RolloutNeighbourhood, { props: { hood: hood([first]) } });
		expect(titles(container)).toHaveLength(1);
		await rerender({ hood: hood([win]) });
		const t = titles(container);
		expect(t).toHaveLength(1);
		expect(t[0]).toMatch(/After Hours/);
		expect(container.textContent).not.toMatch(/Schedule gate dl1xx/);
	});
	test('a retained box of a gate no current box claims still stays, marked released', async () => {
		const gone = box({ key: 'gate:smoke', title: 'Smoke', kind: 'gate', gates: ['smoke'] });
		const other = box({ key: 'schedule:ns/after-hours', title: 'After Hours', kind: 'schedule', gates: ['dl'] });
		const { container, rerender } = render(RolloutNeighbourhood, { props: { hood: hood([gone, other]) } });
		await rerender({ hood: hood([other]) });
		expect(titles(container)).toHaveLength(2);
	});
});
