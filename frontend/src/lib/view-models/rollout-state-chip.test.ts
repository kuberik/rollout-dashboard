import { describe, expect, it } from 'vitest';
import { rolloutStateChip, rolloutMarkState } from './rollout-state-chip';

describe('rolloutStateChip', () => {
	it('maps every bake status to the Overview word and role', () => {
		expect(rolloutStateChip('Succeeded')).toMatchObject({ role: 'ready', label: 'deployed' });
		expect(rolloutStateChip('Failed')).toMatchObject({ role: 'failing', label: 'failed' });
		expect(rolloutStateChip('InProgress').role).toBe('checking');
		expect(rolloutStateChip('Deploying').role).toBe('deploying');
		expect(rolloutStateChip(undefined).role).toBe('unranked');
	});
});

describe('rolloutMarkState', () => {
	it('draws the header pill state as a mark, so a tile beside the header cannot say healthy (visual audit #4)', () => {
		expect(rolloutMarkState('Failed')).toBe('failed');
		expect(rolloutMarkState('InProgress')).toBe('checking');
		expect(rolloutMarkState('Deploying')).toBe('deploying');
		expect(rolloutMarkState('Succeeded')).toBeNull();
		expect(rolloutMarkState(undefined)).toBeNull();
	});
});
