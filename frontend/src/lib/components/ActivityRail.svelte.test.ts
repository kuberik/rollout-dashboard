import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import ActivityRail from './ActivityRail.svelte';

const MIN = 60_000;
function rollout(name: string, entries: { ago: number; status: string; v: string }[]) {
	return {
		metadata: { name, namespace: `${name}-staging`, annotations: {} },
		spec: {},
		status: {
			history: entries.map((e) => ({
				version: { tag: e.v, version: e.v },
				timestamp: new Date(Date.now() - e.ago * MIN).toISOString(),
				bakeStatus: e.status,
				triggeredBy: { kind: 'System', name: 'System' }
			}))
		}
	} as never;
}

describe('ActivityRail day header — a failed count is red only while unresolved', () => {
	it('calm: a failure the rollout has since recovered from counts, in neutral ink', () => {
		const r = rollout('checkout-worker', [
			{ ago: 5, status: 'Succeeded', v: 'b2' },
			{ ago: 10, status: 'Failed', v: 'b1' }
		]);
		const { container } = render(ActivityRail, { props: { rollouts: [r], environments: [] } });
		const failed = container.querySelector('[data-failed-open]');
		expect(failed?.textContent).toContain('1 failed');
		expect(failed?.textContent).toContain('resolved');
		expect(failed?.className ?? '').not.toContain('text-danger');
	});
	it('incident: a rollout still failed keeps the count in danger ink', () => {
		const r = rollout('checkout-worker', [
			{ ago: 3, status: 'Failed', v: 'b2' },
			{ ago: 30, status: 'Succeeded', v: 'b1' }
		]);
		const { container } = render(ActivityRail, { props: { rollouts: [r], environments: [] } });
		const failed = container.querySelector('[data-failed-open]');
		expect(failed?.getAttribute('data-failed-open')).toBe('true');
		expect(failed?.className ?? '').toContain('text-danger');
	});
});

describe('ActivityRail day header — each day judged on its own failure', () => {
	it('a failure yesterday stays resolved when the rollout failed again today', () => {
		const DAY = 24 * 60;
		const r = rollout('checkout-worker', [
			{ ago: 1, status: 'Failed', v: 'b3' },
			{ ago: DAY + 60, status: 'Succeeded', v: 'b2' },
			{ ago: DAY + 120, status: 'Failed', v: 'b1' }
		]);
		const { container } = render(ActivityRail, { props: { rollouts: [r], environments: [] } });
		const marks = [...container.querySelectorAll('[data-failed-open]')].map((e) => e.getAttribute('data-failed-open'));
		expect(marks).toEqual(['true', 'false']);
	});
});
