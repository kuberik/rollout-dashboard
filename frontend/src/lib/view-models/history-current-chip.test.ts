import { expect, it } from 'vitest';
import { currentRowChip } from './history-current-chip';
import { rolloutStateChip } from './rollout-state-chip';

it('currency only for a healthy current row, in the neutral count chip (QA2 #9)', () => {
	expect(currentRowChip('Succeeded', 0)).toEqual({ role: 'count', label: 'Up to date' });
	expect(currentRowChip('Succeeded', 7)).toEqual({ role: 'count', label: '7 builds behind' });
	expect(currentRowChip('Cancelled', 0)).toBeNull();
	expect(currentRowChip(undefined, 0)).toBeNull();
});

it('a failed or in-flight current row prints the header pill: same role, same word (visual audit #3)', () => {
	for (const s of ['Failed', 'InProgress', 'BakeTimeRetrying', 'Deploying']) {
		const head = rolloutStateChip(s);
		expect(currentRowChip(s, 3), s).toEqual({ role: head.role, label: head.label });
	}
	/* the one that shipped: grey `count` "Failing" under a red `failing` "failed" header */
	expect(currentRowChip('Failed', 0)).toEqual({ role: 'failing', label: 'failed' });
	/* a state is never drawn in the count chip */
	for (const s of ['Failed', 'InProgress', 'Deploying']) expect(currentRowChip(s, 0)?.role).not.toBe('count');
});
