import { describe, expect, it } from 'vitest';
import { rolloutStateChip } from './rollout-state-chip';

describe('rolloutStateChip', () => {
	it('maps every bake status to the Overview word and role', () => {
		expect(rolloutStateChip('Succeeded')).toMatchObject({ role: 'ready', label: 'deployed' });
		expect(rolloutStateChip('Failed')).toMatchObject({ role: 'failing', label: 'failed' });
		expect(rolloutStateChip('InProgress').role).toBe('checking');
		expect(rolloutStateChip('Deploying').role).toBe('deploying');
		expect(rolloutStateChip(undefined).role).toBe('unranked');
	});

	it('a failed deploy reads failing while a check fails now, failed once recovered or with no check involved; the role stays failing', () => {
		expect(rolloutStateChip('Failed', null, true)).toMatchObject({ role: 'failing', label: 'failing' });
		expect(rolloutStateChip('Failed', null, false)).toMatchObject({ role: 'failing', label: 'failed' });
		expect(rolloutStateChip('Failed')).toMatchObject({ label: 'failed' });
		expect(rolloutStateChip('Succeeded', null, true).label).toBe('deployed');
	});
});
