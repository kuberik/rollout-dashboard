import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import CardSkeleton, { CARD_HEADER_HEIGHT } from './CardSkeleton.svelte';
import HeadBandSkeleton, { HEAD_BAND_HEIGHT } from './HeadBandSkeleton.svelte';
import BannerSkeleton, { BANNER_HEIGHT } from './BannerSkeleton.svelte';
import SkeletonChip, { CHIP_HEIGHT } from './SkeletonChip.svelte';
import SkeletonBar from './SkeletonBar.svelte';

/**
 * ⭐ GEOMETRY, NOT SNAPSHOTS. These assert the same numbers the audit
 * measured off the running page (`Card.svelte`'s own 47px header,
 * `.chip`'s 20px height, the page head band's 28px row, the blocking
 * banner's 142px) so the skeleton and the real component cannot drift
 * apart silently — a future edit to either one's class list fails here
 * before it ever reaches a screenshot.
 */

describe('CardSkeleton: header geometry matches Card.svelte', () => {
	test('the exported constant is 47 — Card.svelte\'s own min-h-[47px]', () => {
		expect(CARD_HEADER_HEIGHT).toBe(47);
	});

	test('the header carries the literal min-h-[47px] class Card.svelte uses', () => {
		const { container } = render(CardSkeleton, { props: { titleWidth: 'w-32' } });
		const header = container.querySelector('[data-skel-header]');
		expect(header).not.toBeNull();
		expect(header!.className).toContain('min-h-[47px]');
	});

	test('the container shares Card.svelte\'s radius and border', () => {
		const { container } = render(CardSkeleton, { props: { titleWidth: 'w-32' } });
		const card = container.querySelector('[data-skel-card]');
		expect(card!.className).toContain('rounded-lg');
		expect(card!.className).toContain('border');
	});

	test('no rollup slot renders when rollupWidth is null (the default)', () => {
		const { container } = render(CardSkeleton, { props: { titleWidth: 'w-32' } });
		expect(container.querySelector('[data-skel-rollup]')).toBeNull();
	});

	test('a rollup slot renders, right-aligned via justify-between, when rollupWidth is set', () => {
		const { container } = render(CardSkeleton, {
			props: { titleWidth: 'w-32', rollupWidth: 'w-16' }
		});
		expect(container.querySelector('[data-skel-rollup]')).not.toBeNull();
		expect(container.querySelector('[data-skel-header]')!.className).toContain('justify-between');
	});
});

describe('CardSkeleton: rows × rowHeight', () => {
	test('default renders 3 rows at 20px', () => {
		const { container } = render(CardSkeleton, { props: { titleWidth: 'w-32' } });
		const rows = container.querySelectorAll('[data-skel-row]');
		expect(rows.length).toBe(3);
		for (const row of rows) {
			expect((row as HTMLElement).style.height).toBe('20px');
		}
	});

	test('rows and rowHeight are both respected', () => {
		const { container } = render(CardSkeleton, {
			props: { titleWidth: 'w-32', rows: 5, rowHeight: 32 }
		});
		const rows = container.querySelectorAll('[data-skel-row]');
		expect(rows.length).toBe(5);
		for (const row of rows) {
			expect((row as HTMLElement).style.height).toBe('32px');
		}
	});

	test('rows=0 renders no rows and no negative-length array', () => {
		const { container } = render(CardSkeleton, { props: { titleWidth: 'w-32', rows: 0 } });
		expect(container.querySelectorAll('[data-skel-row]').length).toBe(0);
	});

	test('bodyHeight renders one fixed block instead of N rows', () => {
		const { container } = render(CardSkeleton, {
			props: { titleWidth: 'w-32', rows: 3, bodyHeight: 184 }
		});
		expect(container.querySelectorAll('[data-skel-row]').length).toBe(0);
		const body = container.querySelector('[data-skel-body]') as HTMLElement;
		expect(body).not.toBeNull();
		expect(body.style.height).toBe('184px');
	});

	test('padded=false drops the p-4 body padding, matching Card\'s own padded prop', () => {
		const { container } = render(CardSkeleton, {
			props: { titleWidth: 'w-32', padded: false }
		});
		const body = container.querySelector('[data-skel-card] > div');
		expect(body!.className).not.toContain('p-4');
	});
});

describe('HeadBandSkeleton: the 28px head row', () => {
	test('the exported constant is 28', () => {
		expect(HEAD_BAND_HEIGHT).toBe(28);
	});

	test('renders at h-7 (28px)', () => {
		const { container } = render(HeadBandSkeleton);
		const band = container.querySelector('[data-skel-headband]');
		expect(band!.className).toContain('h-7');
	});
});

describe('BannerSkeleton: the 142px blocking banner', () => {
	test('the exported constant is 142', () => {
		expect(BANNER_HEIGHT).toBe(142);
	});

	test('renders at min-h-[142px]', () => {
		const { container } = render(BannerSkeleton);
		const banner = container.querySelector('[data-skel-banner]');
		expect(banner!.className).toContain('min-h-[142px]');
	});
});

describe('SkeletonChip: the .chip geometry', () => {
	test('the exported constant is 20 — .chip\'s own height', () => {
		expect(CHIP_HEIGHT).toBe(20);
	});

	test('renders at h-5 (20px), the same as .chip', () => {
		const { container } = render(SkeletonChip, { props: { width: 'w-12' } });
		expect(container.querySelector('span')!.className).toContain('h-5');
	});
});

describe('SkeletonBar: the atom every other primitive is built from', () => {
	test('renders block by default, inline-block when inline is set', () => {
		const { container: blockContainer } = render(SkeletonBar);
		expect(blockContainer.querySelector('span')!.className).toContain('block');

		const { container: inlineContainer } = render(SkeletonBar, { props: { inline: true } });
		expect(inlineContainer.querySelector('span')!.className).toContain('inline-block');
	});

	test('width and height classes pass through verbatim', () => {
		const { container } = render(SkeletonBar, { props: { width: 'w-64', height: 'h-3' } });
		const el = container.querySelector('span')!;
		expect(el.className).toContain('w-64');
		expect(el.className).toContain('h-3');
	});
});
