import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AutoRollbackVerdicts from './AutoRollbackVerdicts.svelte';
import type { VerdictRow } from '$lib/view-models/auto-rollback';

const row = (over: Partial<VerdictRow>): VerdictRow => ({ key: 'k', cls: 'kustomization', type: 'RolloutTest', ref: 'ns/smoke', kind: 'TestFailed', rollsBack: true, word: 'rolls back', why: 'Test failed · the check rolls back on test failures', rule: 'CheckRollbackOn', short: '', ...over });

describe('AutoRollbackVerdicts', () => {
	test('a failure that rolls back reads in danger ink, one that does not is muted', () => {
		const { container } = render(AutoRollbackVerdicts, { rows: [row({}), row({ key: 'j', ref: 'ns/flaky', rollsBack: false, word: 'does not roll back' })] });
		const words = [...container.querySelectorAll('[data-testid="verdict-word"]')];
		expect(words.map((w) => w.textContent?.trim())).toEqual(['rolls back', 'does not roll back']);
		expect(words[0].className).toContain('text-danger');
		expect(words[1].className).not.toContain('text-danger');
	});
	test('names the source by its short name, whole identifier in the title', () => {
		const { container } = render(AutoRollbackVerdicts, { rows: [row({})] });
		expect(container.querySelector('.t-code-sm')?.textContent).toBe('smoke');
		expect(container.querySelector('[title]')?.getAttribute('title')).toBe('RolloutTest ns/smoke · Test failed · the check rolls back on test failures');
	});
	test('an unusual reason gets two words on the row; the ordinary case says nothing', () => {
		const { container } = render(AutoRollbackVerdicts, { rows: [row({}), row({ key: 'j', ref: 'ns/flaky', rollsBack: false, word: 'does not roll back', short: 'opted out' })] });
		expect([...container.querySelectorAll('[data-testid="verdict-short"]')].map((e) => e.textContent)).toEqual(['opted out']);
	});
	test('when the rollback did not run, a failure that rolls back says "would roll back"', () => {
		const { container } = render(AutoRollbackVerdicts, { rows: [row({})], would: true });
		expect(container.querySelector('[data-testid="verdict-word"]')?.textContent?.trim()).toBe('would roll back');
		// never danger ink for a rollback that did not happen
		expect(container.querySelector('[data-testid="verdict-word"]')?.classList.contains('text-danger')).toBe(false);
	});
	test('when the rollback ran, a failure that rolled back is danger ink', () => {
		const { container } = render(AutoRollbackVerdicts, { rows: [row({})] });
		expect(container.querySelector('[data-testid="verdict-word"]')?.classList.contains('text-danger')).toBe(true);
	});
});
