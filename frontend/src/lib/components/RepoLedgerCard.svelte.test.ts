import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import RepoLedgerCard from './RepoLedgerCard.svelte';
import { buildRevisionLedger } from '$lib/view-models/revision-ledger';
import { repoSlug } from '$lib/version-utils';
import type { Environment, Rollout } from '../../types';

const SOURCE = 'https://github.com/acme/monorepo.git';

type Rel = { tag: string; version?: string; revision: string; created: string };

function rel(sha: string, label: string | undefined, minutesAgo: number): Rel {
	return {
		tag: `main-${sha}`,
		version: label,
		revision: `${sha}${'0'.repeat(40)}`.slice(0, 40),
		created: new Date(Date.now() - minutesAgo * 60_000).toISOString()
	};
}

function rollout(
	name: string,
	ns: string,
	releases: Rel[],
	history: { r: Rel; minutesAgo: number }[]
): Rollout {
	return {
		metadata: { name, namespace: ns },
		spec: {},
		status: {
			source: SOURCE,
			availableReleases: [...releases].reverse(),
			history: history.map((h) => ({
				version: h.r,
				timestamp: new Date(Date.now() - h.minutesAgo * 60_000).toISOString(),
				bakeStatus: 'Succeeded'
			}))
		}
	} as unknown as Rollout;
}

function environment(app: string, ns: string, tier: string): Environment {
	return {
		metadata: { name: app, namespace: ns },
		spec: { environment: tier, name: app, rolloutRef: { name: app } }
	} as unknown as Environment;
}

/**
 * One repo, one service, a build labelled `2.67.0-67` — the exact shape
 * finding 1 (2026-09-09, BLOCKING) is about: `/revisions?q=2.67.0-67`
 * matched at the head band but not inside any repository card.
 */
function fixture() {
	const build = rel('9f10e49', '2.67.0-67', 10);
	const rollouts = [rollout('api', 'api-dev', [build], [{ r: build, minutesAgo: 5 }])];
	const environments = [environment('api', 'api-dev', 'dev')];
	const [repo] = buildRevisionLedger(rollouts, environments);
	return repo;
}

describe('RepoLedgerCard', () => {
	/**
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 (r11c) — THE SHELL IS `Card` NOW,
	 * NOT A HAND-ROLLED `<a class="tap-zone">` HEADER. `Card`'s own titleHref
	 * pattern is `<header class="tap-zone">` wrapping `<h2><a class=
	 * "tap-link">` — the region-is-a-destination contract still holds (one
	 * real link, the rest of the header raised above its own overlay), it is
	 * just the PRODUCT'S one implementation of it instead of a second one.
	 */
	test('the whole header is one region to the repository page, via Card\'s own tap-zone/tap-link pattern', () => {
		const repo = fixture();
		const { container } = render(RepoLedgerCard, { repo, now: new Date() });
		const zone = container.querySelector('header.tap-zone');
		expect(zone).not.toBeNull();
		const link = zone!.querySelector('a.tap-link');
		expect(link).not.toBeNull();
		expect(link!.getAttribute('href')).toBe(`/revisions/${repoSlug(repo.repoKey)}`);
		// No `<a>` nested inside another `<a>` anywhere in the header.
		expect(zone!.querySelectorAll('a a').length).toBe(0);
	});

	test('the ledger renders the service and its build', () => {
		const repo = fixture();
		render(RepoLedgerCard, { repo, now: new Date() });
		expect(screen.getByText('api')).toBeInTheDocument();
		expect(screen.getByText('9f10e49')).toBeInTheDocument();
	});

	/**
	 * ⭐ FINDING 1 REGRESSION, AT THE COMPONENT LEVEL. A query matching the
	 * release LABEL (not the sha) must still show this repo's ledger line —
	 * the defect was the ledger's own line-level filter never checking
	 * labels, which is exactly what `matchesRevisionText` + `revisionLookup`
	 * fix in `revision-ledger.ts`, wired in here.
	 */
	test('a query matching the release label finds the ledger line — finding 1', () => {
		const repo = fixture();
		render(RepoLedgerCard, { repo, now: new Date(), query: '2.67.0-67' });
		expect(screen.queryByText('no match')).toBeNull();
		expect(screen.getByText('api')).toBeInTheDocument();
	});

	test('a query matching nothing prints "No build matches" and the header says "no match"', () => {
		const repo = fixture();
		render(RepoLedgerCard, { repo, now: new Date(), query: 'zzzzzzz' });
		expect(screen.getByText('no match')).toBeInTheDocument();
		expect(screen.getByText(/No build matches/)).toBeInTheDocument();
	});

	test('the footer names the lifetime counts and links out to the repository, hover-capable via .nav-link', () => {
		const repo = fixture();
		render(RepoLedgerCard, { repo, now: new Date(), repoUrl: 'https://github.com/acme/monorepo' });
		const link = screen.getByRole('link', { name: /Open on GitHub/ });
		expect(link).toHaveClass('nav-link');
		expect(link.getAttribute('href')).toBe('https://github.com/acme/monorepo');
	});

	test('at a single repository the ledger is uncapped and folds nothing', () => {
		const build = rel('aaaaaaa', undefined, 5);
		const rollouts = Array.from({ length: 8 }, (_, i) =>
			rollout(`svc-${i}`, `svc-${i}-dev`, [build], [{ r: build, minutesAgo: 1 }])
		);
		const environments = rollouts.map((_, i) => environment(`svc-${i}`, `svc-${i}-dev`, 'dev'));
		const [repo] = buildRevisionLedger(rollouts, environments);
		render(RepoLedgerCard, { repo, now: new Date(), uncapped: true });
		expect(screen.queryByText(/Show \d+ more service/)).toBeNull();
		for (let i = 0; i < 8; i++) expect(screen.getByText(`svc-${i}`)).toBeInTheDocument();
	});

	test('capped at 6, an 8-service repo offers "Show 2 more services"', () => {
		const build = rel('aaaaaaa', undefined, 5);
		const rollouts = Array.from({ length: 8 }, (_, i) =>
			rollout(`svc-${i}`, `svc-${i}-dev`, [build], [{ r: build, minutesAgo: 1 }])
		);
		const environments = rollouts.map((_, i) => environment(`svc-${i}`, `svc-${i}-dev`, 'dev'));
		const [repo] = buildRevisionLedger(rollouts, environments);
		render(RepoLedgerCard, { repo, now: new Date() });
		expect(screen.getByText('Show 2 more services')).toBeInTheDocument();
	});

	/**
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 (r11c) — `filterable`, THE
	 * REPOSITORY PAGE'S MODE. B.4 item 4: the header is plain (no link — the
	 * page already names the repository), the title reads "What each service
	 * runs" with a bare "N services" rollup, and row names become
	 * `aria-pressed` toggle buttons instead of `/apps/<name>` links.
	 */
	function twoServiceFixture() {
		const build = rel('aaaaaaa', undefined, 5);
		const rollouts = [
			rollout('api', 'api-dev', [build], [{ r: build, minutesAgo: 1 }]),
			rollout('web', 'web-dev', [build], [{ r: build, minutesAgo: 1 }])
		];
		const environments = [environment('api', 'api-dev', 'dev'), environment('web', 'web-dev', 'dev')];
		const [repo] = buildRevisionLedger(rollouts, environments);
		return repo;
	}

	test('filterable: the header names "What each service runs" and a bare service count, no link', () => {
		const repo = twoServiceFixture();
		const { container } = render(RepoLedgerCard, { repo, now: new Date(), filterable: true });
		expect(screen.getByText('What each service runs')).toBeInTheDocument();
		expect(screen.getByText('2 services')).toBeInTheDocument();
		// No header link at all in this mode — the page already IS the repository.
		expect(container.querySelector('header a')).toBeNull();
	});

	test('filterable: row names are toggle buttons, not /apps/<name> links', () => {
		const repo = twoServiceFixture();
		render(RepoLedgerCard, { repo, now: new Date(), filterable: true });
		// The button's accessible name is its own visible text (the service
		// name) — no `aria-label` overriding it. `title` carries the
		// "Show only …" hint as a native tooltip instead (r11d).
		const button = screen.getByRole('button', { name: 'api' });
		expect(button).toHaveAttribute('aria-pressed', 'false');
		expect(button).toHaveAttribute('title', 'Show only api');
		expect(screen.queryByRole('link', { name: 'api' })).toBeNull();
	});

	/**
	 * ⭐ REVISIONS-PASS-6, ITEM 2 (r11d) — PLAIN TEXT AT REST, NOT A BORDERED
	 * BUTTON. Round 11c's `.svc-name-toggle` drew a 1px border AND a fill on
	 * every row at rest, so the repository page's ledger read as a form —
	 * every service name a button, none of them plain. Rest now matches the
	 * INDEX's own plain name exactly (no border, no fill); a border appears
	 * only on hover/focus-visible, and the pressed state keeps Lane 7's
	 * standing gray-900/white toggle fill unchanged.
	 */
	test('filterable: the toggle is plain text at rest and keeps the standing toggle fill once pressed', async () => {
		const repo = twoServiceFixture();
		render(RepoLedgerCard, { repo, now: new Date(), filterable: true });
		const button = screen.getByRole('button', { name: 'api' });
		// No border colour and no fill at rest — `border-transparent` (the
		// border WIDTH stays reserved via `.svc-name-toggle` so hovering
		// never shifts layout, only its colour changes).
		expect(button.className).toContain('border-transparent');
		expect(button.className).not.toContain('bg-gray-900');
		expect(button.className).not.toContain('bg-white');
		// A border colour is reserved for hover/focus-visible only.
		expect(button.className).toContain('hover:border-gray-300');
		expect(button.className).toContain('focus-visible:border-gray-300');
		await fireEvent.click(button);
		expect(button).toHaveAttribute('aria-pressed', 'true');
		expect(button.className).toContain('bg-gray-900');
		expect(button.className).toContain('dark:bg-white');
	});

	test('filterable: selecting one service narrows the ledger and recounts the header rollup', async () => {
		const repo = twoServiceFixture();
		render(RepoLedgerCard, { repo, now: new Date(), filterable: true });
		expect(screen.getByText('web')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'api' }));
		expect(screen.queryByText('web')).toBeNull();
		expect(screen.getByText('1 service')).toBeInTheDocument();
	});

	/**
	 * ⭐ LANE 9, ROUND 11 QA, ITEM 9 — A `?q=` MATCH ON ONE SERVICE MUST NOT
	 * PULL IN A SIBLING SHARING THE SAME REVISION. `twoServiceFixture`'s
	 * `api` and `web` are two DIFFERENT services running the identical
	 * commit (`aaaaaaa`) — exactly the live-cluster shape (`hello-api-app` /
	 * `hello-frontend-app`) the operator walk reported: `?q=api` used to
	 * still draw `web`'s own line, because the ledger's line filter checked
	 * the whole ROW's `matchesRevisionText` (which matches on ANY service
	 * sharing the row, `api` included) rather than asking whether `web`
	 * ITSELF — name, its own row's sha/label — matches.
	 */
	test('a text query naming one service excludes a sibling sharing the same revision', () => {
		const repo = twoServiceFixture();
		render(RepoLedgerCard, { repo, now: new Date(), filterable: true, query: 'api' });
		expect(screen.getByText('api')).toBeInTheDocument();
		expect(screen.queryByText('web')).toBeNull();
	});
});
