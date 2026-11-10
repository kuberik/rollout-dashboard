import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import HistorySummaryCard from './HistorySummaryCard.svelte';

describe('HistorySummaryCard', () => {
	// AD round 5, nits: "the deploy count appears 3× — keep it in the header
	// meta, and drop it from the card rollup and the Summary title." This
	// card no longer takes or renders a `deploys` prop at all — the figure
	// moved to being stated exactly once, in the page header's own meta line.
	test('does not render a Deploys figure', () => {
		render(HistorySummaryCard, {
			rangeLabel: 'last 30d',
			failed: 0,
			rolledBack: 1,
			medianHealthyMs: 5 * 60_000,
			lastFailureAgo: null,
			kept: 'last 20 deploys'
		});
		expect(screen.queryByText('Deploys')).toBeNull();
	});

	test('a calm window spends no hue on Failed', () => {
		render(HistorySummaryCard, {
			rangeLabel: 'last 30d',
			failed: 0,
			rolledBack: 1,
			medianHealthyMs: 5 * 60_000,
			lastFailureAgo: null,
			kept: 'last 20 deploys'
		});
		const failedValue = screen.getByText('Failed').previousElementSibling;
		expect(failedValue?.textContent).toBe('0');
		expect(failedValue?.className).not.toContain('text-danger');
		expect(screen.getByText('none in range')).toBeInTheDocument();
	});

	test('Failed takes danger ink only when > 0 (failedOpen defaults to failed > 0)', () => {
		render(HistorySummaryCard, {
			rangeLabel: 'last 30d',
			failed: 1,
			rolledBack: 1,
			medianHealthyMs: null,
			lastFailureAgo: '5m ago',
			kept: null
		});
		const failedValue = screen.getByText('Failed').previousElementSibling;
		expect(failedValue?.textContent).toBe('1');
		expect(failedValue?.className).toContain('text-danger');
		expect(screen.getByText('5m ago')).toBeInTheDocument();
		expect(screen.queryByText('Kept')).toBeNull();
	});

	// AD round 9, item 4: "danger ink only while the failure is unresolved."
	// A failure a later deploy already superseded (`failedOpen: false`) reads
	// the same neutral ink every other settled figure on this card does.
	test('a RESOLVED failure (failedOpen: false) reads fg, not danger', () => {
		render(HistorySummaryCard, {
			rangeLabel: 'last 30d',
			failed: 1,
			failedOpen: false,
			rolledBack: 1,
			medianHealthyMs: 5 * 60_000,
			lastFailureAgo: '3d ago',
			kept: null
		});
		const failedValue = screen.getByText('Failed').previousElementSibling;
		expect(failedValue?.textContent).toBe('1');
		expect(failedValue?.className).not.toContain('text-danger');
		expect(failedValue?.className).toContain('text-fg');
	});

	// AD round 4, item 4: "the Summary must not say 'none in range' for All."
	test('"No failures", not "none in range", when the window is not scoped (All)', () => {
		render(HistorySummaryCard, {
			rangeLabel: 'all time',
			failed: 0,
			rolledBack: 1,
			medianHealthyMs: 5 * 60_000,
			lastFailureAgo: null,
			kept: null,
			scoped: false
		});
		expect(screen.getByText('No failures')).toBeInTheDocument();
		expect(screen.queryByText('none in range')).toBeNull();
	});
});
