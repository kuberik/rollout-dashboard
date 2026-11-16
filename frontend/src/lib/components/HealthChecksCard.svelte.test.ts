import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import HealthChecksCard from './HealthChecksCard.svelte';
import type { HealthCheck } from '../../types';

/** Every row in the card, top to bottom, by its `displayName` — found by the
 *  row's own `data-testid`, since no row carries a status chip. */
function rowNames(): string[] {
	return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="hc-row"]')).map(
		(row) => row.querySelector('span')?.textContent?.trim() ?? ''
	);
}

/**
 * One row grammar for every state: glyph, name, and "state · age" under the
 * name. No row draws a state chip; the specs below assert that on the class
 * list, because a words-only check would pass with a chip back in the row.
 */

const WINDOW_START = new Date('2026-09-13T09:00:00Z');

function hc(name: string, status: string, extra: Record<string, unknown> = {}): HealthCheck {
	return {
		metadata: { name, namespace: 'default' },
		status: { status, ...extra }
	} as HealthCheck;
}

/** Every element in the card that states a check's state as a chip — never
 *  present in any row. */
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

	test('no row draws a state chip: every state is glyph + name + "state · age"', () => {
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
		expect(stateMarks()).toEqual([]);
		expect(document.querySelectorAll('[data-testid="hc-row"]').length).toBe(4);
		expect(document.querySelectorAll('[data-testid="hc-sub"]').length).toBe(4);
	});

	test("a pending row's raw provider status is the title of its fact line", () => {
		render(HealthChecksCard, {
			props: { healthChecks: [hc('probe', 'Pending', { lastErrorTime: '2026-09-13T09:30:00Z' })], windowStart: WINDOW_START }
		});
		const sub = document.querySelector('[data-testid="hc-sub"]')!;
		expect(sub.textContent).toContain('pending');
		expect(sub.getAttribute('title')).toBe('Pending');
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

	test('the pending word reads in progress ink', () => {
		render(HealthChecksCard, {
			props: { healthChecks: [hc('probe', 'Pending')] }
		});
		const sub = document.querySelector('[data-testid="hc-sub"]')!;
		expect(sub.textContent).not.toBe('');
		expect(document.querySelector('.chip')).toBeNull();
	});

	test('a recovered check draws no chip (the rollup and fact line say it); neither does the passing one', () => {
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
		expect(marks).toEqual([]);
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
		expect(stateMarks()).toEqual([]);
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

describe('HealthChecksCard — row height does not depend on state', () => {
	const states: Array<[string, HealthCheck]> = [
		['pending', hc('a', 'Pending')],
		['passing', hc('a', 'Healthy')],
		['failing', hc('a', 'Failed', { message: 'x'.repeat(400) })],
		[
			'recovered',
			hc('a', 'Healthy', {
				lastErrorTime: '2026-09-13T09:30:00Z',
				message: 'back in SLO '.repeat(30)
			})
		]
	];

	test.each(states)('%s row is name + exactly one single-line fact', (_n, check) => {
		render(HealthChecksCard, { props: { healthChecks: [check], windowStart: WINDOW_START } });
		const row = document.querySelector<HTMLElement>('[data-testid="hc-row"]')!;
		const subs = row.querySelectorAll<HTMLElement>('[data-testid="hc-sub"]');
		expect(subs).toHaveLength(1);
		expect(subs[0].className).toContain('truncate');
		// no extra block under the name: no message paragraph, no show-more button
		expect(row.querySelectorAll('p')).toHaveLength(subs[0].tagName === 'P' ? 1 : 0);
		expect(row.textContent).not.toContain('Show more');
	});

	test('a passing row states a fact, so it is as tall as a pending one', () => {
		render(HealthChecksCard, {
			props: {
				healthChecks: [hc('a', 'Healthy', { lastChangeTime: '2026-09-13T09:30:00Z' })],
				windowStart: null
			}
		});
		expect(screen.getByTestId('hc-sub').textContent).toMatch(/^\s*passing/);
	});
});

describe('state words and rollup ink', () => {
	test('a waiting pending check says "pending" under its name, and no chip follows the name', () => {
		render(HealthChecksCard, {
			props: { healthChecks: [hc('probe', 'Pending', { message: 'evaluating', lastChangeTime: '2026-09-13T09:30:00Z' })] }
		});
		const sub = document.querySelector('[data-testid="hc-sub"]');
		expect(sub?.textContent?.trim()).toMatch(/^pending\s*\u00b7/);
		expect(sub?.textContent).not.toMatch(/waiting/);
		const nameLine = document.querySelector('[data-testid="hc-row"] .flex.min-w-0.items-center');
		expect(nameLine?.textContent?.trim()).toBe('probe');
	});

	test('only the failing part of the rollup is in danger ink', () => {
		render(HealthChecksCard, {
			props: { healthChecks: [hc('a', 'Failed', { message: 'x' }), hc('b', 'Pending', { message: 'y' }), hc('c', 'Healthy')] }
		});
		const parts = Array.from(document.querySelectorAll('span')).filter((s) => /^\d+ (failing|pending|passing)$/.test(s.textContent ?? '') && s.children.length === 0);
		const ink = Object.fromEntries(parts.map((s) => [s.textContent!.split(' ')[1], s.className]));
		expect(ink.failing).toContain('text-danger');
		expect(ink.pending).not.toContain('text-danger');
		expect(ink.pending).not.toContain('text-progress');
		expect(ink.passing).not.toContain('text-danger');
	});
});

describe('evidence wrapper', () => {
	test('a row with no evidence draws no empty wrapper', () => {
		render(HealthChecksCard, { props: { healthChecks: [hc('quiet', 'Healthy')] } });
		expect(document.querySelectorAll('[data-testid="hc-row"] .pl-7')).toHaveLength(0);
	});
});
