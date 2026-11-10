import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import DeployBars from './DeployBars.svelte';
import { bucketize } from '$lib/view-models/deploy-bars';

const H = 3_600_000;

function setup(extra: Record<string, unknown> = {}) {
	// jsdom has no layout: give the container a width so the chart draws.
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
	const buckets = bucketize([1 * H, 2 * H, 2.5 * H, 20 * H], 0, 24 * H, 24);
	return render(DeployBars, { buckets, ariaLabel: '4 deploys', ...extra });
}

describe('DeployBars', () => {
	it('draws one single-fill bar per non-empty bucket and a Now edge', () => {
		const { container } = setup();
		expect(container.querySelectorAll('rect.db-bar')).toHaveLength(3);
		expect(container.querySelector('.db-now')).not.toBeNull();
		expect(container.textContent).toContain('Now');
	});
	it('draws ghost bars only for a previous window', () => {
		const prev = bucketize([3 * H, 3.1 * H], 0, 24 * H, 24);
		const { container } = setup({ previous: prev });
		expect(container.querySelectorAll('rect.db-ghost')).toHaveLength(1);
	});
	it('labels markers in their tone', () => {
		const { container } = setup({
			markers: [{ key: 'f', tsMs: 10 * H, label: 'a02f1c4', tone: 'failed', title: 'checkout-worker failed' }]
		});
		expect(container.querySelector('.db-m-failed')).not.toBeNull();
		expect(container.textContent).toContain('a02f1c4');
	});
	it('focusable buckets report clicks', async () => {
		const onBucketClick = vi.fn();
		const { container } = setup({ onBucketClick });
		const hit = container.querySelectorAll('button.db-hit')[2] as HTMLButtonElement;
		// One tab stop for the group (roving): the newest non-empty bucket.
		expect([...container.querySelectorAll('button.db-hit')].filter((b) => (b as HTMLButtonElement).tabIndex === 0)).toHaveLength(1);
		await fireEvent.click(hit);
		expect(onBucketClick).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }));
	});
});

describe('DeployBars round 2 (Home v2 AD r1)', () => {
	it('draws an emphasised bucket in the darker depth, still one bar', () => {
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
		const buckets = bucketize([1 * H, 2 * H], 0, 24 * H, 24).map((b, i) => (i === 2 ? { ...b, emphasis: true } : b));
		const { container } = render(DeployBars, { buckets, ariaLabel: 'x' });
		expect(container.querySelectorAll('rect.db-bar')).toHaveLength(2);
		expect(container.querySelectorAll('rect.db-bar-em')).toHaveLength(1);
	});
	it('puts a failure mark on the series and the previous window behind its bar', () => {
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
		const buckets = bucketize([10.2 * H], 0, 24 * H, 24);
		const previous = bucketize([10.5 * H], 0, 24 * H, 24);
		const { container } = render(DeployBars, {
			buckets,
			previous,
			markers: [{ key: 'f', tsMs: 10.4 * H, label: 'api', tone: 'failed', font: 'sans' }],
			ariaLabel: 'x'
		});
		expect(container.querySelector('circle.db-on-failed')).not.toBeNull();
		const ghost = container.querySelector('rect.db-ghost')!;
		const bar = container.querySelector('rect.db-bar')!;
		expect(Number(ghost.getAttribute('x'))).toBe(Number(bar.getAttribute('x')));
		expect(container.querySelector('.db-ptext-sans')?.textContent).toBe('api failed');
		// The marker line runs through its bar's centre.
		const line = container.querySelector('.db-m-failed .db-mline')!;
		const bx = Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')) / 2;
		expect(Number(line.getAttribute('x1'))).toBeCloseTo(bx, 1);
	});
});

describe('DeployBars marker links', () => {
	it('makes a marker with an href one named link above the bucket layer', () => {
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
		const buckets = bucketize([10.2 * H], 0, 24 * H, 24);
		const { container } = render(DeployBars, {
			buckets,
			markers: [
				{ key: 'f', tsMs: 10.4 * H, label: 'a02f1c4', tone: 'failed', title: 'checkout-worker: failed a02f1c4', href: '/rollouts/x' },
				{ key: 'r', tsMs: 3 * H, label: 'api reached prod', tone: 'release' }
			],
			ariaLabel: 'x'
		});
		const links = container.querySelectorAll('a.db-link');
		expect(links).toHaveLength(1);
		expect(links[0].getAttribute('href')).toBe('/rollouts/x');
		expect(links[0].getAttribute('aria-label')).toBe('Open checkout-worker: failed a02f1c4');
		expect(links[0].querySelector('.db-link-hit')).not.toBeNull();
	});
});

describe('DeployBars resolved, keyboard, previous words', () => {
	it('draws a resolved failure in neutral ink with "resolved"', () => {
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
		const { container } = render(DeployBars, {
			buckets: bucketize([10.2 * H], 0, 24 * H, 24),
			markers: [{ key: 'f', tsMs: 10.4 * H, label: 'hello-world', tone: 'failed', font: 'sans', resolved: true }],
			ariaLabel: 'x'
		});
		expect(container.querySelector('.db-m-failed')).toBeNull();
		expect(container.querySelector('.db-m-resolved')).not.toBeNull();
		expect(container.querySelector('circle.db-on-resolved')).not.toBeNull();
		expect(container.textContent).toContain('hello-world failed · resolved');
	});
	it('is one tab stop and moves with the arrow keys', async () => {
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
		const { container } = render(DeployBars, { buckets: bucketize([2 * H, 5 * H], 0, 24 * H, 24), ariaLabel: 'x' });
		const hits = [...container.querySelectorAll('button.db-hit')] as HTMLButtonElement[];
		expect(hits.filter((b) => b.tabIndex === 0)).toHaveLength(1);
		expect(hits[5].tabIndex).toBe(0);
		hits[5].focus();
		await fireEvent.keyDown(hits[5], { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(hits[4]);
	});
});

describe('DeployBars average label', () => {
	it('sits at the left end of its line, clear of the newest bars', () => {
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
		const { container } = render(DeployBars, { buckets: bucketize([1 * H, 2 * H, 20 * H, 20.5 * H, 23 * H], 0, 24 * H, 24), ariaLabel: 'x' });
		const t = container.querySelector('text.db-avg-text')!;
		expect(t.getAttribute('text-anchor')).toBe('start');
		expect(Number(t.getAttribute('x'))).toBeLessThan(100);
	});
});

describe('DeployBars clipped outlier with a failure', () => {
	it('lifts the true value above the on-series mark', () => {
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
		const ts = [...Array.from({ length: 60 }, () => 23.5 * H), 1 * H, 2 * H, 3 * H, 4 * H, 5 * H, 6 * H, 7 * H];
		const { container } = render(DeployBars, {
			buckets: bucketize(ts, 0, 24 * H, 24),
			markers: [{ key: 'f', tsMs: 23.6 * H, label: 'api', tone: 'failed' }],
			ariaLabel: 'x'
		});
		const t = container.querySelector('text.db-over')!;
		const dot = container.querySelector('circle.db-onseries')!;
		expect(t.textContent).toBe('60');
		expect(Number(t.getAttribute('y'))).toBeLessThan(Number(dot.getAttribute('cy')) - 6);
	});
});
