/**
 * MOCK MODE SERVES A CONNECTED GITHUB, AND IT AGREES WITH THE MOCK FLEET.
 *
 * `MOCK_API=1 pnpm run dev` (and the static demo) answer every GitHub-backed read from `github-data.ts`: status
 * (connected, viewer `danielreed`), the changes feed, PR lookups and commit ranges. This pins the end-to-end
 * contract through `respond()` (the one router the dev plugin and the demo shim both call), so a docs screenshot
 * of Home, /changes, a change page, the PR view, the palette paste or the change-version dialog never lands on a
 * "GitHub is not connected" state, and so a repo the fleet deploys never lacks changes:
 *
 *  - the status is connected and names the viewer;
 *  - every repo a rollout in the fleet links has changes in the feed (same repos, commits, releases);
 *  - every PR in the feed resolves on the PR route (the pasted-URL flow itself is in scripts/mock-github-smoke.mjs);
 *  - no two repos share a commit sha (payout-api and billing-edge run the same tags);
 *  - the viewer authors some changes ("yours");
 *  - the unknown-PR and unknown-repo answers stay the real 404 shapes (scope pr / repo).
 *
 * Mock mode only: nothing here is reachable from the real backend path (`respond` is imported by the dev plugin
 * and the demo build alone).
 */
import { describe, expect, it } from 'vitest';
import { respond } from './respond';
import type { ChangesResponse } from '../api/changes';
import type { GithubStatus } from '../api/github';
import type { PullRequestInfo } from '../api/pulls';

const get = (url: string) => respond('GET', url);
const parse = <T>(url: string): T => JSON.parse(get(url).body as string) as T;

describe('mock GitHub (respond)', () => {
	it('is connected, with the viewer named', () => {
		const s = parse<GithubStatus>('/api/auth/github/status');
		expect(s.configured).toBe(true);
		expect(s.connected).toBe(true);
		expect(s.login).toBe('danielreed');
	});

	const changes = parse<ChangesResponse>('/api/github/changes?days=90');

	it('has changes the viewer authored', () => {
		expect(changes.user).toBe('danielreed');
		expect(changes.changes.some((c) => c.author === 'danielreed')).toBe(true);
	});

	it('has changes for every repo a rollout in the fleet links', () => {
		const fleet = get('/api/rollouts').body as string;
		const repos = new Set([...fleet.matchAll(/github\.com\/([\w-]+\/[\w-]+)/g)].map((m) => m[1]));
		expect(repos.size).toBeGreaterThan(5);
		const have = new Set(changes.changes.map((c) => `${c.owner}/${c.repo}`));
		const missing = [...repos].filter((r) => !have.has(r));
		expect(missing).toEqual([]);
	});

	it('the bypass-demo apps\' newest change is the build their rollouts offer (same sha)', () => {
		const fleet = get('/api/rollouts').body as string;
		for (const repo of ['payout-api', 'billing-edge', 'invoice-worker']) {
			const newest = changes.changes.filter((c) => c.repo === repo && c.kind === 'pr').sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))[0];
			expect(newest, repo).toBeDefined();
			expect(fleet.includes(newest.mergeCommitSha!), `${repo} ${newest.mergeCommitSha}`).toBe(true);
		}
	});

	it('never gives two repos the same commit sha', () => {
		const seen = new Map<string, string>();
		for (const c of changes.changes) {
			const sha = c.mergeCommitSha;
			if (!sha) continue;
			const prev = seen.get(sha);
			expect(prev === undefined || prev === `${c.owner}/${c.repo}`, `${sha} in ${prev} and ${c.owner}/${c.repo}`).toBe(true);
			seen.set(sha, `${c.owner}/${c.repo}`);
		}
	});

	it('resolves every PR of the feed on the PR route', () => {
		const prs = changes.changes.filter((c) => c.kind === 'pr');
		expect(prs.length).toBeGreaterThan(10);
		for (const c of prs) {
			const r = get(`/api/github/pulls/${c.owner}/${c.repo}/${c.number}`);
			expect(r.status, `${c.owner}/${c.repo}#${c.number}`).toBe(200);
			expect((JSON.parse(r.body as string) as PullRequestInfo).number).toBe(c.number);
		}
	});

	it('keeps the real 404 shapes for an unknown PR and an unknown repo', () => {
		const known = changes.changes.find((c) => c.kind === 'pr')!;
		const a = get(`/api/github/pulls/${known.owner}/${known.repo}/99999`);
		expect(a.status).toBe(404);
		expect(JSON.parse(a.body as string).scope).toBe('pr');
		const b = get('/api/github/pulls/nobody/nothing/1');
		expect(b.status).toBe(404);
		expect(JSON.parse(b.body as string).scope).toBe('repo');
	});
});
