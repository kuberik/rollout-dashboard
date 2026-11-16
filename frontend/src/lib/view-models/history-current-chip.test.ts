import { expect, it } from 'vitest';
import { currentRowChip } from './history-current-chip';

it('currency only for a healthy current row; otherwise the shared state word (QA2 #9)', () => {
	expect(currentRowChip('Succeeded', 0)).toBe('Up to date');
	expect(currentRowChip('Succeeded', 7)).toBe('7 builds behind');
	expect(currentRowChip('Failed', 0)).toBe('Failed');
	expect(currentRowChip('Deploying', 0)).toBe('Deploying');
	expect(currentRowChip('InProgress', 3)).toBe('Checking');
	expect(currentRowChip('Cancelled', 0)).toBeNull();
	expect(currentRowChip(undefined, 0)).toBeNull();
});

import { deploysFailedParts } from './history-current-chip';
it('the Deploys "N failed" rollup splits failing / failed with the shared ink', () => {
	const off = { open: false, failingNow: false, recovered: false };
	// a check failing now: the open failure reads failing in danger ink, the older ones failed in neutral ink
	expect(deploysFailedParts(3, { open: true, failingNow: true, recovered: false })).toEqual([{ text: '1 failing', ink: 'text-danger' }, { text: '2 failed', ink: 'text-fg-muted' }]);
	expect(deploysFailedParts(1, { open: true, failingNow: true, recovered: false })).toEqual([{ text: '1 failing', ink: 'text-danger' }]);
	// recovered: failed in neutral ink, never danger
	expect(deploysFailedParts(2, { open: true, failingNow: false, recovered: true })).toEqual([{ text: '2 failed', ink: 'text-fg-muted' }]);
	// no health check involved: a failed deploy stays failed, in danger ink
	expect(deploysFailedParts(1, { open: true, failingNow: false, recovered: false })).toEqual([{ text: '1 failed', ink: 'text-danger' }]);
	// superseded failures are neutral
	expect(deploysFailedParts(2, off)).toEqual([{ text: '2 failed', ink: 'text-fg-muted' }]);
	expect(deploysFailedParts(0, off)).toEqual([]);
});
