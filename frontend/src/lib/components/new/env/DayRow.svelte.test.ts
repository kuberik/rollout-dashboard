import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import DayRow from './DayRow.svelte';

/** /envs/<env> Today: the place's newest failure whose checks recovered is the ring; any other failed row is the solid disc. */
describe('DayRow failed mark', () => {
	const row = (recovered?: boolean) => ({ key: 'k', kind: 'failed' as const, app: 'catalog-api', href: '/rollouts/x/y/z', place: '', title: null, build: 'a1b2c3d', who: 'Automatic', age: '3h', mark: null, reason: null, ...(recovered ? { recovered } : {}) });
	const chip = (recovered?: boolean) => render(DayRow, { row: row(recovered) }).container.querySelector('.dr-mk span.rounded-full')!.className;
	it('ring vs solid', () => {
		expect(chip(true)).toContain('ring-[1.5px]');
		expect(chip()).toContain('bg-danger-solid');
	});
});
