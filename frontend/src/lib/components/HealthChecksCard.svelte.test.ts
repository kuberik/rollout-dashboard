import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import HealthChecksCard from './HealthChecksCard.svelte';
import type { HealthCheck } from '../../types';

/** Every row in the card, top to bottom, by its `displayName` — found by the
 *  row's own `data-testid`, not by the status mark, since a passing OR
 *  failing row no longer carries one (see the chip-budget note below). */
function rowNames(): string[] {
	return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="hc-row"]')).map(
		(row) => row.querySelector('span')?.textContent?.trim() ?? ''
	);
}

/**
 * ⭐ NEW BY DESIGN (2026-09-13, demo capture, lane 4; migrated to the shared
 * design language and the chip-budget rule 2026-10-08, then tightened again
 * in round 2 of the same coordinator review). ROLE: the regression guard for
 * ONE STATUS GRAMMAR in this card. WHY NOTHING EXISTING FITS: this component
 * had no test file at all, and the defect it originally shipped a fix for —
 * a FILLED `rounded-full` capsule on the pending row beside BARE GREEN TEXT
 * on the passing rows, 40px apart, for the same axis — is invisible to every
 * other guard in the suite. WHICH REFERENCE LENDS ITS PROPORTIONS:
 * `ChangeHistoryCard.svelte.test.ts`.
 *
 * ⛔ THE CHIP BUDGET, ROUND 2 (2026-10-08, coordinator review): "one fact,
 * once" — a row spends at most two emphases, the NAME and ONE status mark.
 * Round 1 dropped the chip for a PASSING row (the green glyph is already the
 * mark). Round 2 does the same for a FAILING row: the glyph is red, and the
 * row now prints `failing · <time>` in that same red ink instead of a chip
 * — red glyph + red words is one mark, not two. Pending and recovered rows
 * still keep their chip, because their glyph alone cannot carry PENDING vs
 * RECOVERED (no single glyph does).
 *
 * ⚠️ IT ASSERTS ON THE CLASS LIST, WHICH IS UNUSUAL HERE AND DELIBERATE. The
 * thing under test IS the geometry: every status mark that DOES render must
 * be the product's chip atom (`.chip.t-label`) and no status mark may carry
 * a fill. A test that only checked the words would have passed on the day
 * the original defect shipped.
 */

const WINDOW_START = new Date('2026-09-13T09:00:00Z');

function hc(name: string, status: string, extra: Record<string, unknown> = {}): HealthCheck {
	return {
		metadata: { name, namespace: 'default' },
		status: { status, ...extra }
	} as HealthCheck;
}

/** Every element in the card that states a check's state as a chip — never
 *  present for a passing or failing row (see the chip-budget note above). */
function stateMarks(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('.chip.t-label'));
}

/** The red "failing · <time>" text for a failing row, found by its row. */
function failingWord(rowIndex = 0): HTMLElement | undefined {
	const row = document.querySelectorAll<HTMLElement>('[data-testid="hc-row"]')[rowIndex];
	return Array.from(row?.querySelectorAll('span') ?? []).find((s) =>
		(s.textContent ?? '').trim().startsWith('failing')
	);
}

describe('HealthChecksCard — one status grammar', () => {
	test('a passing check carries its state in the glyph alone, with no chip', () => {
		render(HealthChecksCard, { props: { healthChecks: [hc('flux', 'Healthy')] } });
		expect(stateMarks()).toHaveLength(0);
		expect(rowNames()).toEqual(['flux']);
	});

	test('a failing check carries its state in red text, with no chip', () => {
		render(HealthChecksCard, {
			props: { healthChecks: [hc('latency', 'Failed', { message: 'p99 over SLO' })] }
		});
		expect(stateMarks()).toHaveLength(0);
		const word = failingWord();
		expect(word).not.toBeUndefined();
		expect(word!.className).toContain('text-danger');
		expect(word!.textContent).toContain('failing');
	});

	test('pending rows draw the chip atom; passing and failing rows draw none', () => {
		render(HealthChecksCard, {
			props: {
				healthChecks: [
					hc('latency', 'Failed', { message: 'p99 over SLO' }),
					hc('probe', 'Pending', { message: 'evaluating' }),
					hc('flux', 'Healthy'),
					hc('down', 'Healthy')
				]
			}
		});
		const marks = stateMarks();
		expect(marks.map((m) => m.textContent?.trim())).toEqual(['pending']);
		// ⛔ THE ASSERTION THE OLD CARD WOULD HAVE FAILED: the pending row was a
		// `rounded-full bg-yellow-100 px-2 py-0.5` capsule.
		for (const m of marks) {
			expect(m.className).toContain('chip');
			expect(m.className).toContain('t-label');
			expect(m.className).not.toMatch(/rounded-full/);
			expect(m.className).not.toMatch(/\bbg-/);
		}
	});

	test('a pending row never prints the controller message as a verdict (batch4 #6)', () => {
		render(HealthChecksCard, {
			props: {
				healthChecks: [
					hc('probe', 'Pending', { message: 'No alerts firing for labels map[app:x]' })
				]
			}
		});
		const row = document.querySelector('[data-testid="hc-row"]')!;
		expect(row.textContent).not.toMatch(/No alerts firing/);
		expect(row.textContent).toContain('Not evaluated yet');
	});

	test('a pending row keeps a message that is real information (alert about to fire)', () => {
		render(HealthChecksCard, {
			props: {
				healthChecks: [
					hc('probe', 'Pending', { message: 'alert HighErrorRate is pending, fires after 5m' })
				]
			}
		});
		expect(document.querySelector('[data-testid="hc-row"]')!.textContent).toContain(
			'fires after 5m'
		);
	});

	test('colour, and only colour, carries the state', () => {
		render(HealthChecksCard, {
			props: { healthChecks: [hc('probe', 'Pending')] }
		});
		const [pending] = stateMarks();
		expect(pending.className).toContain('text-progress');
		expect(pending.className).toContain('border-progress-line');
	});

	test('a recovered check keeps its chip; the passing check beside it does not', () => {
		render(HealthChecksCard, {
			props: {
				healthChecks: [
					hc('latency', 'Healthy', {
						lastErrorTime: '2026-09-13T09:30:00Z',
						message: 'p99 back within SLO'
					}),
					hc('flux', 'Healthy')
				],
				windowStart: WINDOW_START
			}
		});
		const marks = stateMarks();
		expect(marks.map((m) => m.textContent?.trim())).toEqual(['recovered']);
		expect(marks[0].className).toContain('chip');
		expect(marks[0].className).toContain('text-progress');
		expect(rowNames()).toEqual(['latency', 'flux']);
	});

	test('the failing row’s title still carries the controller enum', () => {
		render(HealthChecksCard, { props: { healthChecks: [hc('latency', 'Failed')] } });
		const row = document.querySelector<HTMLElement>('[data-testid="hc-row"]');
		// The glyph itself keeps the raw status as its accessible/title detail
		// in the row; the visible word is the card's own ("failing"), never
		// the raw CRD enum ("Failed", "Unknown").
		expect(failingWord()?.textContent).not.toContain('Failed');
	});

	test('the card renders nothing when there are no checks', () => {
		render(HealthChecksCard, { props: { healthChecks: [] } });
		expect(screen.queryByText('Health checks')).not.toBeInTheDocument();
		expect(stateMarks()).toHaveLength(0);
	});
});

/**
 * ⛔ FILM CRITIC FINDING 2 (2026-09-21): a pending check's row lived in the
 * `pendingChecks` `{#each}` block near the top; the instant it passed, it
 * reclassified into `healthyChecks`, a SEPARATE `{#each}` block at the
 * bottom — the row visibly jumped down and swapped places with whatever had
 * been below it, in the same frame the badge turned green. Row order is now
 * decided once, at mount, and a status change must never move a row.
 */
describe('HealthChecksCard — row order holds through a status change', () => {
	test('a pending row does not reorder when it passes', async () => {
		const before: HealthCheck[] = [
			hc('latency', 'Failed', { message: 'p99 over SLO' }),
			hc('probe', 'Pending', { message: 'evaluating' }),
			hc('flux', 'Healthy'),
			hc('down', 'Healthy')
		];
		const { rerender } = render(HealthChecksCard, { props: { healthChecks: before } });
		expect(stateMarks().map((m) => m.textContent?.trim())).toEqual(['pending']);
		expect(rowNames()).toEqual(['latency', 'probe', 'flux', 'down']);

		// `probe` passes. If the card re-sorted, it would fall to wherever a
		// freshly-classified `passing` row lands (the end) instead of holding
		// the second slot it opened in.
		const after: HealthCheck[] = [
			hc('latency', 'Failed', { message: 'p99 over SLO' }),
			hc('probe', 'Healthy'),
			hc('flux', 'Healthy'),
			hc('down', 'Healthy')
		];
		await rerender({ healthChecks: after });

		expect(rowNames()).toEqual(['latency', 'probe', 'flux', 'down']);
		// `probe` is passing now, so it draws no chip at all; `latency` is
		// still failing, which also draws no chip (red text instead) — so no
		// chip anywhere in this card once `probe` resolves.
		expect(stateMarks()).toHaveLength(0);
	});

	test('a brand-new check appends at the end, never inserted mid-list', async () => {
		// `probe` (pending, priority 1) sorts ahead of `flux` (passing,
		// priority 3) on the INITIAL order, same "pending first" rule as
		// every other fixture in this file — the point under test is what
		// happens next, not this ordering itself.
		const before: HealthCheck[] = [hc('flux', 'Healthy'), hc('probe', 'Pending')];
		const { rerender } = render(HealthChecksCard, { props: { healthChecks: before } });
		expect(rowNames()).toEqual(['probe', 'flux']);

		const after: HealthCheck[] = [
			hc('flux', 'Healthy'),
			hc('probe', 'Pending'),
			hc('new-check', 'Failed', { message: 'just showed up' })
		];
		await rerender({ healthChecks: after });

		// Even though `new-check` is FAILING (priority 0, ahead of both
		// existing rows by the initial-order rule), it is a NEWCOMER, so it
		// only ever appends after whatever is already placed — the initial
		// rule governs a key's OWN first appearance, never a reshuffle of
		// rows that got here first.
		expect(rowNames()).toEqual(['probe', 'flux', 'new-check']);
	});
});
