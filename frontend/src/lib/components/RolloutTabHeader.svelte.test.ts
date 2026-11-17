import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import RolloutTabHeader from './RolloutTabHeader.svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ⭐ THE PHONE HEADER ON EVERY ROLLOUT TAB (LOGOPEN r8, item 3, squad-rollout
 * coordinator, 2026-10-11): below lg the state chip leads the meta line and a
 * 44px "Roll back" ends it, so a failed build's header is two lines, not four.
 * From lg up nothing moves: the chip stays in the title row and the action
 * keeps its "Roll back to <sha>" in the right-aligned slot. jsdom does not
 * evaluate media queries, so this pins the markup each side relies on: the
 * phone copies are `data-phone-only` + `lg:hidden`, the lg+ action is
 * `data-desktop-only` + `max-lg:hidden` (language.css collapses its cell on a
 * phone), and a tab that passes no meta of its own gets the
 * `data-meta-phone-only` marker that collapses the phone-only row at sm+.
 */
const state = vi.hoisted(() => ({
	page: {
		params: {
			cluster: 'staging',
			namespace: 'checkout-worker-staging',
			name: 'checkout-worker'
		} as Record<string, string>,
		url: new URL('http://localhost/rollouts/staging/checkout-worker-staging/checkout-worker/logs'),
		route: { id: null as string | null },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));
vi.mock('$app/state', () => state);

const failed = {
	metadata: { name: 'checkout-worker', namespace: 'checkout-worker-staging' },
	spec: {},
	status: {
		history: [
			{
				bakeStatus: 'Failed',
				version: { tag: 'a02f1c4', created: '2026-10-11T10:00:00Z' },
				timestamp: '2026-10-11T10:00:00Z'
			},
			{
				bakeStatus: 'Succeeded',
				version: { tag: '3f1ed09', created: '2026-10-10T10:00:00Z' },
				timestamp: '2026-10-10T10:00:00Z'
			}
		]
	}
} as never;

describe('RolloutTabHeader: the phone meta line (LOGOPEN r8)', () => {
	test('a failed build: the chip and a short "Roll back" join the meta line below sm; sm+ keeps its slot', () => {
		const { container } = render(RolloutTabHeader, {
			props: { name: 'checkout-worker', rollout: failed }
		});
		const phone = container.querySelector('button[data-phone-only]') as HTMLButtonElement;
		expect(phone).not.toBeNull();
		expect(phone.textContent?.trim()).toBe('Roll back');
		expect(phone.closest('[data-phone-actions]')!.className).toMatch(/\blg:hidden\b/);
		expect(phone.className).toMatch(/\bh-11\b/);

		const desktop = container.querySelector('button[data-desktop-only]') as HTMLButtonElement;
		expect(desktop.textContent?.trim()).toBe('Roll back');
		expect(desktop.className).toMatch(/\bmax-lg:hidden\b/);
		// buttons, not links: the confirm opens in place
		expect(phone.getAttribute('href')).toBeNull();
		expect(desktop.getAttribute('href')).toBeNull();

		const row = container.querySelector('.dot-list-row')!;
		expect(row.querySelector('[data-phone-only]')?.textContent).toMatch(/failed/i);
		// No meta of its own: the row exists only for the phone.
		expect(row.querySelector('[data-meta-phone-only]')).not.toBeNull();
	});

	test('inlineRollback={false} keeps the action off both lines', () => {
		const { container } = render(RolloutTabHeader, {
			props: { name: 'checkout-worker', rollout: failed, inlineRollback: false }
		});
		expect(container.querySelector('button[data-phone-only]')).toBeNull();
		expect(container.querySelector('button[data-desktop-only]')).toBeNull();
	});
});

/**
 * ONE LINE, ALWAYS (item 3): the phone status line ("deployed 3 weeks ago", a
 * 3-digit deploy count, many rollbacks) never wraps. jsdom cannot measure
 * layout, so this pins the DROP RULE the layout is built on; the measured proof
 * is ic-header/oneline.cjs (Playwright, real long strings at 390, both
 * scenarios). Rule: the chip and the action never shrink or drop; facts
 * truncate with an ellipsis, the LAST fact first (shrink 100), the first last.
 */
describe('RolloutTabHeader: the phone meta line stays one line (drop rule)', () => {
	const css = readFileSync(resolve(__dirname, '../../styles/language.css'), 'utf8');
	const block = css.slice(css.indexOf('LOGOPEN r11b'));

	test('the row is marked and never wraps below lg', () => {
		const { container } = render(RolloutTabHeader, {
			props: { name: 'checkout-worker', rollout: failed }
		});
		expect(container.querySelector('.dot-list-row > [data-rth-meta]')).not.toBeNull();
		expect(block).toMatch(/:has\(> \[data-rth-meta\]\)\s*\{\s*flex-wrap: nowrap/);
	});

	test('chip and action never shrink; facts ellipsise, last first', () => {
		expect(block).toMatch(/\[data-rth-meta\]\) > \* \{\s*flex-shrink: 0;\s*white-space: nowrap/);
		expect(block).toMatch(/text-overflow: ellipsis/);
		expect(block).toMatch(/flex-shrink: 100/);
		const { container } = render(RolloutTabHeader, {
			props: { name: 'checkout-worker', rollout: failed }
		});
		// chip + action are the data-phone-only copies the rule exempts
		expect(container.querySelectorAll('[data-phone-only]').length).toBeGreaterThanOrEqual(2);
	});
});

/** One state word on every tab: a failed head whose check fails now reads "failing", a recovered or check-less failure reads "failed". */
describe('RolloutTabHeader: the failure word follows failingNow', () => {
	const words = (props: Record<string, unknown>) => {
		const { container } = render(RolloutTabHeader, { props: { name: 'checkout-worker', rollout: failed, ...props } });
		return [...container.querySelectorAll('[data-phone-only], .chip, [class*="chip"]')].map((e) => e.textContent?.trim().toLowerCase()).join(' ');
	};
	test('failingNow reads failing, not failed', () => {
		expect(words({ failingNow: true })).toContain('failing');
	});
	test('without failingNow it stays failed', () => {
		expect(words({})).toContain('failed');
		expect(words({})).not.toContain('failing');
	});
	test('every route that draws the header on a rollout passes failingNow', () => {
		const base = resolve(__dirname, '../../routes/rollouts/[cluster]/[namespace]/[name]');
		for (const f of ['logs', 'gates', 'history', 'diff/[version]']) {
			const src = readFileSync(resolve(base, f, '+page.svelte'), 'utf8');
			expect(src, f).toMatch(/<RolloutTabHeader[^>]*failingNow|<RolloutTabHeader\s[^<]*?\{failingNow\}|failingNow=\{/s);
		}
	});
});

/** The pair at 390: wherever the lg+ header shows Roll back | Retry (a recovered failure), the phone meta line shows the same two, in the same order; Roll back is never out of reach. */
describe('RolloutTabHeader: the phone shows the same pair as lg+', () => {
	const phoneActs = (recovered: boolean) => {
		const { container } = render(RolloutTabHeader, { props: { name: 'checkout-worker', rollout: failed, recovered } });
		return [...container.querySelectorAll('button[data-phone-only]')].map((a) => `${(a as HTMLElement).dataset.action ?? 'rollback'}:${/btn-primary/.test(a.className) ? 'primary' : 'secondary'}`);
	};
	test('recovered: Roll back (secondary) then Retry (primary)', () => {
		expect(phoneActs(true)).toEqual(['rollback:secondary', 'retry:primary']);
	});
	test('failing now: Roll back (primary) then Retry (secondary), as the Overview banner', () => {
		expect(phoneActs(false)).toEqual(['rollback:primary', 'retry:secondary']);
	});
	test('the pair is its own line under the meta row: not inside it, no separator before it, gap-2', () => {
		const { container } = render(RolloutTabHeader, { props: { name: 'checkout-worker', rollout: failed, recovered: false } });
		const cell = container.querySelector('[data-phone-actions]') as HTMLElement;
		expect(cell.closest('.dot-list-row')).toBeNull();
		expect(cell.className).toMatch(/\bgap-2\b/);
		expect(container.querySelector('[data-ph-below]')?.contains(cell)).toBe(true);
	});
	test('Retry and Roll back on every size are buttons that act in place, never links to the Overview', () => {
		const { container } = render(RolloutTabHeader, { props: { name: 'checkout-worker', rollout: failed, recovered: true } });
		const acts = [...container.querySelectorAll('[data-action="retry"], [data-action="rollback"], [data-desktop-only]')];
		expect(acts.length).toBeGreaterThan(3);
		for (const a of acts) {
			expect(a.tagName).toBe('BUTTON');
			expect(a.getAttribute('href')).toBeNull();
		}
		expect(container.querySelector('a[href*="action="]')).toBeNull();
	});
	test('lg+ draws the same pair in the actions slot on a failing-now rollout (every tab shares this header)', () => {
		const { container } = render(RolloutTabHeader, { props: { name: 'checkout-worker', rollout: failed, recovered: false } });
		const d = [...container.querySelectorAll('button[data-desktop-only]')].map((a) => `${a.textContent?.trim()}:${/btn-primary/.test(a.className) ? 'primary' : 'secondary'}`);
		expect(d).toEqual(['Roll back:primary', 'Retry:secondary']);
	});
});

/** The gap under the phone action pair: one rule on every tab (24px, what Gates and Logs leave under the header), never 0 against a header's own `below` content (History's cadence strip). */
describe('RolloutTabHeader: the space under the phone action pair', () => {
	test('the pair is followed by the below content, and language.css gives it the 24px block gap when something follows', () => {
		const css = readFileSync(resolve(__dirname, '../../styles/language.css'), 'utf8');
		const belowSnippet = createRawSnippet(() => ({ render: () => '<div data-test-below="1"></div>' }));
		expect(css).toMatch(/\[data-phone-actions\]:has\(\+ \*\)\s*\{\s*margin-bottom:\s*24px;/);
		const { container } = render(RolloutTabHeader, { props: { name: 'checkout-worker', rollout: failed, recovered: false, below: belowSnippet } });
		const cell = container.querySelector('[data-phone-actions]') as HTMLElement;
		expect(cell.nextElementSibling?.getAttribute('data-test-below')).toBe('1');
	});
});
