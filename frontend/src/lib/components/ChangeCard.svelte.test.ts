import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import ChangeCard from './ChangeCard.svelte';
import type { ChangeRowVM } from '../view-models/changes';
import type { LandingGridVM, LandingServiceVM } from '../view-models/landing-grid';

/**
 * `ChangeCard` — CHANGES-2026-09-10.md ROUND 2, R2.2. ONE `Card`, three
 * `divide-y` blocks (grid/fold, frontier reason, meta+actions) — the
 * replacement for round 1's "four `Card`s whose entire body is one gray
 * sentence" (`cpr4-1440-light.png`).
 */

function mkService(appName: string, mark: LandingServiceVM['marks'][number]): LandingServiceVM {
	return { appName, marks: [mark], verdictWord: 'held', landedCount: 0, total: 1 };
}

function mkGrid(overrides: Partial<LandingGridVM> = {}): LandingGridVM {
	return { services: [], allSameLabel: null, visible: [], overflow: null, ...overrides };
}

function mkRow(overrides: Partial<ChangeRowVM> = {}): ChangeRowVM {
	return {
		owner: 'acme',
		repo: 'widget',
		repoKey: 'acme/widget',
		kind: 'pr',
		number: 4,
		title: 'fix(frontend): retry on 502',
		sha: 'bf5be4932430f8f3576912d0ae7e57c0a9177383',
		shortSha: 'bf5be49',
		href: '/changes/acme/widget/pull/4',
		htmlUrl: 'https://github.com/acme/widget/pull/4',
		author: 'octocat',
		mergedAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
		verdictWord: 'held in prod',
		verdictTone: 'held',
		grid: mkGrid(),
		notEverywhere: true,
		prodLeadMs: null,
		frontierReason: null,
		...overrides
	};
}

describe('ChangeCard', () => {
	test('renders exactly one card header (`#n title`) — never a per-service card', () => {
		const { container } = render(ChangeCard, { props: { row: mkRow() } });
		expect(container.querySelectorAll('header').length).toBe(1);
		expect(container.querySelector('header')?.textContent).toContain('#4');
	});

	test('the all-same fold prints ONE line in block 1, no landing grid rows', () => {
		const { container } = render(ChangeCard, {
			props: { row: mkRow({ grid: mkGrid({ allSameLabel: 'not built yet · all 5 services' }) }) }
		});
		expect(container.textContent).toContain('not built yet · all 5 services');
		expect(container.querySelectorAll('a.lm').length).toBe(0);
	});

	test('a non-folded grid renders one landing mark per service cell', () => {
		const mark = {
			family: 'PRD',
			familyOrder: 3,
			count: 1,
			state: 'gated' as const,
			tone: 'stuck' as const,
			sentence: 'prod: held by a rule',
			href: '/rollouts/prod/ns/app',
			theme: null
		};
		const services = [mkService('widget-app', mark)];
		const { container } = render(ChangeCard, {
			props: { row: mkRow({ grid: mkGrid({ services, visible: services }) }) }
		});
		expect(container.querySelectorAll('a.lm').length).toBe(1);
	});

	test('the frontier reason line renders when present, and is omitted when null', () => {
		const withReason = render(ChangeCard, {
			props: { row: mkRow({ frontierReason: 'waiting on hello-api-app — its build does not exist yet' }) }
		});
		expect(withReason.container.textContent).toContain('waiting on hello-api-app');
		withReason.unmount();

		const withoutReason = render(ChangeCard, { props: { row: mkRow({ frontierReason: null }) } });
		expect(withoutReason.container.textContent).not.toContain('waiting on');
	});

	test('"Open change ›" points at the change page; "GitHub ↗" only renders when an htmlUrl exists', () => {
		const withUrl = render(ChangeCard, { props: { row: mkRow() } });
		const links = [...withUrl.container.querySelectorAll('a')].map((a) => a.textContent?.trim());
		expect(links).toContain('Open change ›');
		expect(links).toContain('GitHub ↗');
		const openLink = [...withUrl.container.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Open change ›');
		expect(openLink?.getAttribute('href')).toBe('/changes/acme/widget/pull/4');
		withUrl.unmount();

		const withoutUrl = render(ChangeCard, { props: { row: mkRow({ htmlUrl: '' }) } });
		const withoutUrlLinks = [...withoutUrl.container.querySelectorAll('a')].map((a) => a.textContent?.trim());
		expect(withoutUrlLinks).not.toContain('GitHub ↗');
	});

	test('meta line reads `repo · age ago · @author`', () => {
		const { container } = render(ChangeCard, { props: { row: mkRow() } });
		expect(container.textContent).toContain('widget');
		expect(container.textContent).toContain('ago');
		expect(container.textContent).toContain('@octocat');
	});
});
