import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import NextStep, { stepLabel } from './NextStep.svelte';

/**
 * §3.19 — ONE APPROVAL CONFIRM, ONE LABEL TABLE.
 *
 * `stepLabel` is the single place every "approve" control (Home's
 * Needs-you row, the PromotionMap callout, the Gates tab, the command
 * palette) reads its words from. A caller passes the STATE (`step`,
 * optionally `env`) — never a string.
 */
describe('stepLabel — the §3.19 approve vocabulary (qa11b: review form only)', () => {
	// ⛔ qa11b (2026-10-11): "Approve" / "Approve in <env>" are gone until an
	// approval endpoint exists — every approve control navigates to the
	// rollout's Gates tab, so the step always reads the review form.
	test('env not already named: "Review approval in <env>"', () => {
		expect(stepLabel('approve', { env: 'prod' })).toBe('Review approval in prod');
	});

	test('env already named by the row/card: plain "Review approval"', () => {
		expect(stepLabel('approve')).toBe('Review approval');
		expect(stepLabel('approve', { env: null })).toBe('Review approval');
	});

	test('`navigate` no longer changes the words', () => {
		expect(stepLabel('approve', { navigate: true })).toBe('Review approval');
		expect(stepLabel('approve', { navigate: true, env: 'staging' })).toBe('Review approval in staging');
	});

	test('every other step is unaffected by env/navigate', () => {
		expect(stepLabel('promote')).toBe('Deploy newest');
		expect(stepLabel('rollback')).toBe('Roll back');
		expect(stepLabel('investigate', { env: 'prod', navigate: true })).toBe('Investigate');
	});
});

describe('<NextStep> — approve reads the table through the same rules', () => {
	test('href + env: a link reading "Review approval in <env>"', () => {
		render(NextStep, { step: 'approve', href: '/apps/checkout-api', env: 'prod' });
		expect(screen.getByRole('link', { name: 'Review approval in prod' })).toBeInTheDocument();
	});

	test('no surface can render "Approve" from the table', () => {
		render(NextStep, { step: 'approve', onclick: () => {} });
		expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
		expect(screen.getByRole('button', { name: 'Review approval' })).toBeInTheDocument();
	});

	test('an explicit `label` still overrides the table', () => {
		render(NextStep, { step: 'approve', onclick: () => {}, label: 'Deploy 1.2.3' });
		expect(screen.getByRole('button', { name: 'Deploy 1.2.3' })).toBeInTheDocument();
	});
});
