import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
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
		const phone = container.querySelector('a[data-phone-only]') as HTMLAnchorElement;
		expect(phone).not.toBeNull();
		expect(phone.textContent?.trim()).toBe('Roll back');
		expect(phone.className).toMatch(/\blg:hidden\b/);
		expect(phone.className).toMatch(/\bh-11\b/);

		const desktop = container.querySelector('a[data-desktop-only]') as HTMLAnchorElement;
		expect(desktop.textContent?.trim()).toBe('Roll back');
		expect(desktop.className).toMatch(/\bmax-lg:hidden\b/);
		// Same destination: the rollback dialog names the sha.
		expect(phone.getAttribute('href')).toBe(desktop.getAttribute('href'));

		const row = container.querySelector('.dot-list-row')!;
		expect(row.querySelector('[data-phone-only]')?.textContent).toMatch(/failed/i);
		// No meta of its own: the row exists only for the phone.
		expect(row.querySelector('[data-meta-phone-only]')).not.toBeNull();
	});

	test('inlineRollback={false} keeps the action off both lines', () => {
		const { container } = render(RolloutTabHeader, {
			props: { name: 'checkout-worker', rollout: failed, inlineRollback: false }
		});
		expect(container.querySelector('a[data-phone-only]')).toBeNull();
		expect(container.querySelector('a[data-desktop-only]')).toBeNull();
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
