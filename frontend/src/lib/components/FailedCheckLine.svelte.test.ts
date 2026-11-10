import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import FailedCheckLine from './FailedCheckLine.svelte';

/**
 * (History round 14, AD round 10, D4, binding — coordinator follow-up,
 * 2026-10-12): "add the D4 unit test: a past row with failedHealthChecks
 * renders muted, and the live failed row renders danger, using a synthetic
 * history in the test, not the shared scenario." The mock fixtures carry
 * exactly one `failedHealthChecks` array in the whole demo (the incident's
 * own live row), so there is no "past, resolved" example to screenshot
 * without mutating that shared scenario — other lanes' own screenshots
 * depend on it staying failed. Synthetic `check` + `danger` props here
 * instead, same as `history-deeplink.test.ts`'s synthetic `history` arrays.
 */
const check = {
	name: 'checkout-worker-prometheus-high-error-rate',
	message: 'error rate 8.9% over a 1% budget'
};

describe('FailedCheckLine', () => {
	test('the live/open failure (danger=true) renders the glyph and check name in danger ink', () => {
		const { container } = render(FailedCheckLine, { check, danger: true });
		const line = container.querySelector('.t-meta');
		expect(line?.className).toContain('text-danger');
		expect(line?.className).not.toContain('text-fg-muted');
		const nameSpan = [...container.querySelectorAll('span')].find(
			(s) => s.textContent === `${check.name}:`
		);
		expect(nameSpan?.className).toContain('text-danger');
	});

	test('a past, resolved failure (danger=false) renders the SAME shape, muted as a whole', () => {
		const { container } = render(FailedCheckLine, { check, danger: false });
		const line = container.querySelector('.t-meta');
		expect(line?.className).toContain('text-fg-muted');
		expect(line?.className).not.toContain('text-danger');
		const nameSpan = [...container.querySelectorAll('span')].find(
			(s) => s.textContent === `${check.name}:`
		);
		expect(nameSpan?.className).toContain('text-fg-muted');
		expect(nameSpan?.className).not.toContain('text-danger');
	});

	test('the glyph, the check name and the message all still render when muted — same shape, not fewer facts', () => {
		const { container, getByText } = render(FailedCheckLine, { check, danger: false });
		expect(container.querySelector('svg')).toBeTruthy();
		expect(getByText(`${check.name}:`)).toBeTruthy();
		expect(getByText(check.message)).toBeTruthy();
	});

	test("the message stays fg-muted either way — only the glyph/name's ink changes with danger", () => {
		for (const danger of [true, false]) {
			const { getByText, unmount } = render(FailedCheckLine, { check, danger });
			const messageSpan = getByText(check.message);
			expect(messageSpan.className).toContain('text-fg-muted');
			unmount();
		}
	});

	test('carries the `check-line` class the 14px-at-lg+ rule (AD round 11, item 7) is scoped to', () => {
		// jsdom has no layout engine — a `@media (min-width: …)` rule in the
		// component's own `<style>` block never actually resolves to a
		// computed `font-size` here, the same limitation `history-deeplink`'s
		// scroll tests ran into. This asserts the thing jsdom CAN prove: the
		// line carries the class the CSS rule targets, structurally wiring
		// it to the Overview-matching 14px step at `lg`+.
		const { container } = render(FailedCheckLine, { check, danger: true });
		expect(container.querySelector('.check-line')).toBeTruthy();
	});

	describe('no message', () => {
		/**
		 * ⭐ (History round 15, AD round 11, item 7, binding): "FailedCheckLine
		 * with no message drops its trailing colon." A name with nothing to
		 * pair it with reads as a label introducing a value that never
		 * arrives ("checkout-worker-high-error-rate:" and then nothing).
		 */
		const checkNoMessage = { name: 'checkout-worker-prometheus-high-error-rate' };

		test('renders the bare name with no trailing colon', () => {
			const { getByText, queryByText } = render(FailedCheckLine, {
				check: checkNoMessage,
				danger: true
			});
			expect(getByText(checkNoMessage.name)).toBeTruthy();
			expect(queryByText(`${checkNoMessage.name}:`)).toBeNull();
		});

		test('still renders the glyph — the shape is "name alone", not "nothing"', () => {
			const { container } = render(FailedCheckLine, { check: checkNoMessage, danger: true });
			expect(container.querySelector('svg')).toBeTruthy();
		});

		test('an empty-string message is treated the same as no message — no colon, no dangling message span', () => {
			const { getByText, queryByText } = render(FailedCheckLine, {
				check: { name: checkNoMessage.name, message: '' },
				danger: false
			});
			expect(getByText(checkNoMessage.name)).toBeTruthy();
			expect(queryByText(`${checkNoMessage.name}:`)).toBeNull();
		});
	});
});

describe('FailedCheckLine compact (hover card)', () => {
	test('compact keeps the shared line but drops the 14px-at-lg class and clamps to two lines', () => {
		const { container } = render(FailedCheckLine, { check, danger: false, compact: true });
		const line = container.querySelector('.t-meta');
		expect(line?.className).not.toContain('check-line');
		expect(line?.className).toContain('text-fg-muted');
		expect(container.querySelector('.line-clamp-2')).toBeTruthy();
	});
});
