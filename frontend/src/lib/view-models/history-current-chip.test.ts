import { expect, it } from 'vitest';
import { currentRowChip } from './history-current-chip';

it('currency only for a healthy current row; otherwise the shared state word (QA2 #9)', () => {
	expect(currentRowChip('Succeeded', 0)).toBe('Up to date');
	expect(currentRowChip('Succeeded', 7)).toBe('7 builds behind');
	expect(currentRowChip('Failed', 0)).toBe('Failing');
	expect(currentRowChip('Deploying', 0)).toBe('Deploying');
	expect(currentRowChip('InProgress', 3)).toBe('Checking');
	expect(currentRowChip('Cancelled', 0)).toBeNull();
	expect(currentRowChip(undefined, 0)).toBeNull();
});
