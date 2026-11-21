import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import EnvRow from './EnvRow.svelte';
import { beadOf } from '$lib/view-models/bead';

describe('EnvRow beads', () => {
	it('two beads with the same state and #ref (PR #12 in two repos) both draw, no duplicate key', () => {
		const bead = beadOf([{ ref: '#12', state: 'failed' }]);
		const { container } = render(EnvRow, { cells: [{ key: 'prod', label: 'prod', beads: [bead, { ...bead }] }] });
		expect(container.querySelectorAll('[data-bead]')).toHaveLength(2);
	});
});
