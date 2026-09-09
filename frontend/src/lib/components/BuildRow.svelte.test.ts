import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import BuildRowHarness from './BuildRow.harness.svelte';

/**
 * `BuildRow` takes every cell as a snippet — see its own header comment for
 * why (the three build lists disagree about what belongs in each cell; the
 * shared part is the grid). A harness component supplies the snippets,
 * which is the only way to exercise a `Snippet`-prop component from a
 * `.test.ts` file (snippets are not constructible from plain JS).
 */
describe('BuildRow', () => {
	test('renders the mark, identity and roll cells, in one row', () => {
		render(BuildRowHarness);
		expect(screen.getByText('MARK')).toBeInTheDocument();
		expect(screen.getByText('IDENTITY')).toBeInTheDocument();
		expect(screen.getByText('ROLL')).toBeInTheDocument();
	});

	test('is a single `li.bld-row`', () => {
		const { container } = render(BuildRowHarness);
		const rows = container.querySelectorAll('li.bld-row');
		expect(rows).toHaveLength(1);
	});

	test('renders with no `mark` at all — the pending list’s bare identity case', () => {
		render(BuildRowHarness, { noMark: true });
		expect(screen.queryByText('MARK')).toBeNull();
		expect(screen.getByText('IDENTITY')).toBeInTheDocument();
	});
});
