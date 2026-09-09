import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
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
	test('the whole header is ONE link to the repository page, with no nested anchor', () => {
		const repo = fixture();
		const { container } = render(RepoLedgerCard, { repo, now: new Date() });
		const headerLink = container.querySelector('a.tap-zone');
		expect(headerLink).not.toBeNull();
		expect(headerLink!.getAttribute('href')).toBe(`/revisions/${repoSlug(repo.repoKey)}`);
		// No `<a>` nested inside the header's own `<a>`.
		expect(headerLink!.querySelector('a')).toBeNull();
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
});
