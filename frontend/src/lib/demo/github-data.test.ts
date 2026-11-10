import { describe, expect, it } from 'vitest';
import { respondGithub, CURATED_ROLLOUT_NAMES, CURATED_LADDERS } from './github-data';
import type { GithubStatus, CommitsResponse } from '../api/github';
import type { ChangesResponse } from '../api/changes';
import type { PullRequestInfo } from '../api/pulls';
import type { CommitPull } from '../api/commit-pulls';

function get(path: string, params: Record<string, string> = {}) {
	const search = new URLSearchParams(params);
	return respondGithub('GET', path, search);
}

describe('respondGithub — routing', () => {
	it('falls through (null) for a path it does not own', () => {
		expect(get('/api/rollouts')).toBeNull();
		expect(get('/api/events/stream')).toBeNull();
	});
});

describe('respondGithub — /api/auth/github/status', () => {
	it('reports configured and connected, with an offline-safe avatar', () => {
		const res = get('/api/auth/github/status');
		expect(res).not.toBeNull();
		expect(res!.status).toBe(200);
		const body = JSON.parse(res!.body) as GithubStatus;
		expect(body.configured).toBe(true);
		expect(body.connected).toBe(true);
		expect(body.login).toBe('danielreed');
		// Never a network fetch in the static demo build — a real GitHub host
		// would hang / 404 with no backend at all. ⛔ The assertion is the
		// SCHEME, not the format: the signed-in person's avatar is their real
		// photograph (a JPEG, see `demo-avatar.ts`) while every other author
		// still gets a generated SVG, and both are equally offline-safe.
		expect(body.avatarUrl).toMatch(/^data:image\//);
	});

	it('is deterministic across repeated calls', () => {
		const a = get('/api/auth/github/status');
		const b = get('/api/auth/github/status');
		expect(a!.body).toBe(b!.body);
	});
});

describe('respondGithub — commits, forward range', () => {
	it('returns a real forward CommitsResponse for a known hello-world range', () => {
		const res = get('/api/rollouts/default/hello-world/commits', {
			base: 'a1b2c3d',
			head: 'f68d0ac'
		});
		expect(res!.status).toBe(200);
		const body = JSON.parse(res!.body) as CommitsResponse;
		expect(body.direction).toBe('forward');
		expect(body.ahead).toBeGreaterThan(0);
		expect(body.behind).toBe(0);
		expect(body.commits.length).toBeGreaterThanOrEqual(1);
		expect(body.commits.length).toBeLessThanOrEqual(6);
		for (const c of body.commits) {
			expect(c.sha).toBeTruthy();
			expect(c.message).toBeTruthy();
			expect(c.author).toBeTruthy();
			expect(c.authorUrl).toMatch(/^https:\/\/github\.com\//);
			expect(c.avatarUrl).toMatch(/^data:image\/svg\+xml/);
			expect(c.commitDate).toBeTruthy();
			expect(new Date(c.commitDate).toString()).not.toBe('Invalid Date');
			expect(c.url).toContain('/commit/');
		}
		expect(body.additions).toBeGreaterThanOrEqual(0);
		expect(body.deletions).toBeGreaterThanOrEqual(0);
		expect(body.changedFiles).toBeGreaterThanOrEqual(0);
		// The last commit in a forward range names the build actually reached.
		expect(body.commits.at(-1)?.sha).toBe('f68d0ac');
	});

	// AD round 8, item 2: "62d1c05's commit list includes the LATER builds
	// b7e0d41 and d09e6f4. The range must be only the commits between
	// c3a9f22 and 62d1c05 … with no sha collisions." checkout-edge's own
	// ladder has b7e0d41/d09e6f4 sitting BETWEEN c3a9f22 and 62d1c05 in
	// release order (`62d1c05` skipped over them — confirmed live, its own
	// row reads "Skipped 2 releases") even though, in this rollout's actual
	// deploy HISTORY, both later became their own, separately-deployed,
	// separately-detailed rows. Reusing their real tags as "just a commit"
	// inside a DIFFERENT build's range read as the same build twice.
	it('checkout-edge c3a9f22..62d1c05: skipped-over releases never reuse their own real tag as a commit sha', () => {
		const res = get('/api/rollouts/checkout-edge-prod/checkout-edge/commits', {
			base: 'c3a9f22',
			head: '62d1c05'
		});
		expect(res!.status).toBe(200);
		const body = JSON.parse(res!.body) as CommitsResponse;
		expect(body.direction).toBe('forward');
		// The range's own head is still the real tag — this is NOT a bare
		// "always synthetic" change, only the skipped-over middle steps.
		expect(body.commits.at(-1)?.sha).toBe('62d1c05');
		const shas = body.commits.map((c) => c.sha);
		expect(shas).not.toContain('b7e0d41');
		expect(shas).not.toContain('d09e6f4');
		// No two commits in one range share a sha either (AD round 6, item 1
		// — kept honest here specifically, since the fix touches this exact
		// loop).
		expect(new Set(shas).size).toBe(shas.length);
	});

	it('covers checkout-api b-40..b-45 and checkout-worker a02f1c4/3f1ed09', () => {
		const ck = get('/api/rollouts/checkout-api-prod/checkout-api/commits', {
			base: 'b-40',
			head: 'b-45'
		});
		const ckBody = JSON.parse(ck!.body) as CommitsResponse;
		expect(ckBody.direction).toBe('forward');
		// `ahead` is the REAL total commit count across all 5 hops, including
		// filler commits bundled into a transition — so it is at least the hop
		// count, not necessarily equal to it.
		expect(ckBody.ahead).toBeGreaterThanOrEqual(5);
		expect(ckBody.commits.length).toBeGreaterThanOrEqual(1);

		const cw = get('/api/rollouts/checkout-worker-staging/checkout-worker/commits', {
			base: '3f1ed09',
			head: 'a02f1c4'
		});
		const cwBody = JSON.parse(cw!.body) as CommitsResponse;
		expect(cwBody.direction).toBe('forward');
		expect(cwBody.ahead).toBeGreaterThan(0);
	});
});

describe('respondGithub — commits, rollback range', () => {
	it('flips to rollback when head is behind base, and lists what was reverted', () => {
		const res = get('/api/rollouts/default/hello-world/commits', {
			base: 'f68d0ac',
			head: 'a1b2c3d'
		});
		const body = JSON.parse(res!.body) as CommitsResponse;
		expect(body.direction).toBe('rollback');
		expect(body.ahead).toBe(0);
		expect(body.behind).toBeGreaterThan(0);
		expect(body.commits.length).toBeGreaterThanOrEqual(1);
	});
});

describe('respondGithub — commits, same sha', () => {
	it('reports no change when base equals head', () => {
		const res = get('/api/rollouts/default/hello-world/commits', {
			base: 'f68d0ac',
			head: 'f68d0ac'
		});
		const body = JSON.parse(res!.body) as CommitsResponse;
		expect(body).toEqual({
			direction: 'same',
			ahead: 0,
			behind: 0,
			commits: [],
			additions: 0,
			deletions: 0,
			changedFiles: 0
		});
	});
});

describe('respondGithub — commits, unknown range', () => {
	it('answers a single honest commit rather than an error for an unrecognized app', () => {
		const res = get('/api/rollouts/some-ns/totally-unknown-app/commits', {
			base: 'deadbeef',
			head: 'cafef00d'
		});
		expect(res!.status).toBe(200);
		const body = JSON.parse(res!.body) as CommitsResponse;
		expect(body.direction).toBe('forward');
		expect(body.ahead).toBe(1);
		expect(body.commits).toHaveLength(1);
		expect(body.commits[0].sha).toBe('cafef00d');
	});

	it('answers a single honest commit for a known app with unrecognized shas', () => {
		const res = get('/api/rollouts/default/hello-world/commits', {
			base: '1111111',
			head: '2222222'
		});
		const body = JSON.parse(res!.body) as CommitsResponse;
		expect(body.direction).toBe('forward');
		expect(body.ahead).toBe(1);
		expect(body.commits).toHaveLength(1);
	});

	it('degrades honestly when base/head are missing entirely', () => {
		const res = get('/api/rollouts/default/hello-world/commits');
		const body = JSON.parse(res!.body) as CommitsResponse;
		expect(body.direction).toBe('forward');
		expect(body.commits).toHaveLength(1);
	});
});

describe('respondGithub — /api/github/changes', () => {
	it('returns a populated, well-shaped ChangesResponse', () => {
		const res = get('/api/github/changes', { days: '30' });
		expect(res!.status).toBe(200);
		const body = JSON.parse(res!.body) as ChangesResponse;
		expect(typeof body.user).toBe('string');
		expect(body.user.length).toBeGreaterThan(0);
		expect(body.repos.length).toBeGreaterThan(3);
		expect(body.changes.length).toBeGreaterThan(10);
		for (const c of body.changes) {
			expect(c.owner).toBeTruthy();
			expect(c.repo).toBeTruthy();
			expect(['pr', 'commit']).toContain(c.kind);
			if (c.kind === 'pr') expect(c.number).toBeGreaterThan(0);
			expect(c.title).toBeTruthy();
			expect(c.htmlUrl).toMatch(/^https:\/\/github\.com\//);
			expect(c.author).toBeTruthy();
			expect(new Date(c.mergedAt).toString()).not.toBe('Invalid Date');
			expect(c.mergeCommitSha).toBeTruthy();
			expect(c.base).toBeTruthy();
			expect(Array.isArray(c.containedIn)).toBe(true);
			expect(typeof c.containedInAll).toBe('boolean');
		}
	});

	it('includes at least one change authored by the connected demo user', () => {
		const res = get('/api/github/changes', { days: '30' });
		const body = JSON.parse(res!.body) as ChangesResponse;
		expect(body.changes.some((c) => c.author === body.user)).toBe(true);
	});

	it('scopes to the requested window', () => {
		const wide = JSON.parse(get('/api/github/changes', { days: '30' })!.body) as ChangesResponse;
		const narrow = JSON.parse(get('/api/github/changes', { days: '1' })!.body) as ChangesResponse;
		expect(narrow.changes.length).toBeLessThanOrEqual(wide.changes.length);
	});

	it('is deterministic across repeated calls', () => {
		const a = get('/api/github/changes', { days: '30' });
		const b = get('/api/github/changes', { days: '30' });
		expect(a!.body).toBe(b!.body);
	});

	it('includes a real landmark change for a known build (hello-world f68d0ac)', () => {
		const res = get('/api/github/changes', { days: '30' });
		const body = JSON.parse(res!.body) as ChangesResponse;
		const row = body.changes.find((c) => c.repo === 'hello-world' && c.mergeCommitSha === 'f68d0ac');
		expect(row).toBeTruthy();
		expect(row!.containedIn).toContain('f68d0ac');
	});
});

describe('respondGithub — /api/github/pulls/:owner/:repo/:number', () => {
	it('resolves a PR that a changes-feed landmark actually produced', () => {
		const changes = JSON.parse(get('/api/github/changes', { days: '30' })!.body) as ChangesResponse;
		const prChange = changes.changes.find((c) => c.kind === 'pr');
		expect(prChange).toBeTruthy();
		const res = get(`/api/github/pulls/${prChange!.owner}/${prChange!.repo}/${prChange!.number}`);
		expect(res!.status).toBe(200);
		const pull = JSON.parse(res!.body) as PullRequestInfo;
		expect(pull.number).toBe(prChange!.number);
		expect(pull.title).toBe(prChange!.title);
		expect(pull.state).toBe('merged');
		expect(pull.mergeCommitSha).toBe(prChange!.mergeCommitSha);
	});

	it('404s with scope "pr" for a known repo, wrong number', () => {
		const res = get('/api/github/pulls/exampleco/hello-world/999999');
		expect(res!.status).toBe(404);
		expect(JSON.parse(res!.body)).toEqual({ error: 'not_found', scope: 'pr' });
	});

	it('404s with scope "repo" for a repository this cluster never deploys', () => {
		const res = get('/api/github/pulls/exampleco/nonexistent-repo/1');
		expect(res!.status).toBe(404);
		expect(JSON.parse(res!.body)).toEqual({ error: 'not_found', scope: 'repo' });
	});
});

describe('respondGithub — commit → pulls', () => {
	it('returns the associated PR(s) for a commit sha that landed via one', () => {
		const changes = JSON.parse(get('/api/github/changes', { days: '30' })!.body) as ChangesResponse;
		const prChange = changes.changes.find((c) => c.kind === 'pr');
		expect(prChange).toBeTruthy();
		const res = get(
			`/api/github/repos/${prChange!.owner}/${prChange!.repo}/commits/${prChange!.mergeCommitSha}/pulls`
		);
		expect(res!.status).toBe(200);
		const pulls = JSON.parse(res!.body) as CommitPull[];
		expect(pulls.length).toBeGreaterThanOrEqual(1);
		expect(pulls[0].number).toBe(prChange!.number);
	});

	it('returns an empty, non-error array for a sha with no associated PR', () => {
		const res = get('/api/github/repos/exampleco/hello-world/commits/does-not-exist/pulls');
		expect(res!.status).toBe(200);
		expect(JSON.parse(res!.body)).toEqual([]);
	});

	it('404s for a repository this cluster never deploys', () => {
		const res = get('/api/github/repos/exampleco/nonexistent-repo/commits/abc1234/pulls');
		expect(res!.status).toBe(404);
	});
});

describe('respondGithub — the viewer owns the blocked changes', () => {
	it('a02f1c4 (checkout-worker, fails in incident) and 4a8d2e6 (platform-telemetry #20) are the viewer’s', () => {
		const res = get('/api/github/changes', { days: '30' });
		const body = JSON.parse(res!.body) as ChangesResponse;
		const bySha = (sha: string) => body.changes.find((c) => c.mergeCommitSha === sha);
		expect(bySha('a02f1c4')?.author).toBe('danielreed');
		expect(bySha('4a8d2e6')?.author).toBe('danielreed');
	});
});

/**
 * ⭐ (2026-10-11, AD round 6) THE CHRONOLOGY CENSUS. An art director found a
 * commit dated newer than the build it shipped (`9a1f4c2`, the NEWEST
 * checkout-edge build — built minutes ago — read "10 days ago"), and a
 * compare range whose own commits ran out of order (10h/3d/2h/1d/10d). This
 * walks every CURATED app's full ladder (one hand-written title per step —
 * see `CURATED_ROLLOUT_NAMES`'s own doc comment for why `pooled()` apps are
 * out of scope) and asserts, for every one-hop AND root→newest compare:
 *
 *   - every commit's own date is REAL (parses) and not in the future;
 *   - the array is chronologically ordered — each commit's date is not
 *     EARLIER than the one before it (a compare range is oldest→newest, so
 *     "its build's own date" for step N is never after step N+1's);
 *   - no two commits in the same range share a sha OR a title (the
 *     duplicate-title defect a narrow `pooled()` pool used to produce).
 */
describe('respondGithub — commit chronology (curated apps)', () => {
	const ns = 'chronology-test';

	function commitsFor(name: string, base: string, head: string): CommitsResponse {
		const res = get(`/api/rollouts/${ns}/${name}/commits`, { base, head });
		expect(res!.status).toBe(200);
		return JSON.parse(res!.body) as CommitsResponse;
	}

	function assertChronological(name: string, label: string, body: CommitsResponse) {
		let prevMs = -Infinity;
		const seenShas = new Set<string>();
		const seenTitles = new Set<string>();
		for (const c of body.commits) {
			const ms = new Date(c.commitDate).getTime();
			expect(Number.isFinite(ms), `${name} ${label}: ${c.sha} has an invalid commitDate`).toBe(
				true
			);
			expect(ms, `${name} ${label}: ${c.sha} is dated in the future`).toBeLessThanOrEqual(
				Date.now() + 1000
			);
			expect(
				ms,
				`${name} ${label}: ${c.sha} (${c.commitDate}) is dated BEFORE the commit ahead of it — not chronological`
			).toBeGreaterThanOrEqual(prevMs);
			prevMs = ms;

			expect(seenShas.has(c.sha), `${name} ${label}: duplicate sha ${c.sha}`).toBe(false);
			seenShas.add(c.sha);
			expect(seenTitles.has(c.message), `${name} ${label}: duplicate title "${c.message}"`).toBe(
				false
			);
			seenTitles.add(c.message);
		}
	}

	for (const name of CURATED_ROLLOUT_NAMES) {
		const ladder = CURATED_LADDERS[name];
		if (ladder.length < 2) continue;

		it(`${name}: every consecutive hop is chronological, no duplicates`, () => {
			for (let i = 1; i < ladder.length; i++) {
				const body = commitsFor(name, ladder[i - 1], ladder[i]);
				assertChronological(name, `${ladder[i - 1]}..${ladder[i]}`, body);
			}
		});

		it(`${name}: the full root→newest range is chronological, no duplicates`, () => {
			const body = commitsFor(name, ladder[0], ladder[ladder.length - 1]);
			assertChronological(name, `${ladder[0]}..${ladder[ladder.length - 1]}`, body);
			// The newest build's own commit is always the array's last entry
			// (oldest→newest) — see `buildRange`'s own doc comment.
			expect(body.commits.at(-1)?.sha).toBeTruthy();
		});
	}
});

/**
 * (AD round 8 follow-up, 2026-10-11) "Make every sha in github-data.ts's
 * fixture resolve to a distinct title, and add a test asserting that no two
 * shas share a title within an app." The tip's own bug: 7f38e0d and
 * 20b6d7f both read "Fix CORS headers for mobile app origin"; c62a913 read
 * d09e6f4's own "Add rate limiting per API key".
 *
 * ⛔ WHY THE EXISTING CHRONOLOGY DESCRIBE BLOCK DOES NOT ALREADY CATCH THIS.
 * Its "full root→newest range" test calls the SAME endpoint this one does,
 * but `buildRange` caps a long range's own `commits` list at the LAST 6
 * (`github-data.ts`'s own "1-6 commits" budget, mirroring the real GitHub
 * compare API) — checkout-edge alone has 25 ladder steps, so that test's
 * own `assertChronological` physically never sees headline #2 beside
 * headline #20 and cannot have caught either collision above. This test
 * asks for every hop's own title SEPARATELY (a single hop is 1-3 commits,
 * never truncated — `buildRange`'s own comment) and accumulates them
 * across the WHOLE ladder itself, so nothing is hidden by the cap.
 *
 * Scoped to `curated()` apps only (`CURATED_ROLLOUT_NAMES`) — a `pooled()`
 * app's titles are drawn from a small shared pool BY DESIGN (`AppFixture`'s
 * own `curated` field doc: "pooled… can repeat across enough steps"), so a
 * repeat there is not a defect this test should fail on.
 */
describe('respondGithub — no two shas share a title within a curated app (AD round 8 follow-up)', () => {
	const ns = 'title-census-test';

	for (const name of CURATED_ROLLOUT_NAMES) {
		const ladder = CURATED_LADDERS[name];
		if (ladder.length < 2) continue;

		it(`${name}: every ladder step's own headline is globally distinct`, () => {
			const titleOwner = new Map<string, string>(); // title -> the sha that first used it
			for (let i = 1; i < ladder.length; i++) {
				const res = get(`/api/rollouts/${ns}/${name}/commits`, { base: ladder[i - 1], head: ladder[i] });
				expect(res!.status).toBe(200);
				const body = JSON.parse(res!.body) as CommitsResponse;
				const headCommit = body.commits.at(-1);
				// ⛔ NOT `expect(headCommit?.sha).toBe(ladder[i])` — found live,
				// `checkout-api`/`hello-frontend-app`/`standalone-api` use
				// human-readable version labels as ladder tags ("b-41",
				// "rel-63", "s-11"), never literal git shas, so their own HEAD
				// commit's `sha` is a synthesized hex id, not the tag string
				// (same reason the existing chronology block's own "full
				// root→newest" test only asserts the head sha is truthy, not
				// equal to the tag — this follows that same, already-settled
				// precedent rather than re-litigating it here). The title is
				// this test's only concern.
				expect(headCommit, `${name}: hop ${ladder[i - 1]}..${ladder[i]} returned no commits`).toBeTruthy();
				const title = headCommit!.message;
				const owner = titleOwner.get(title);
				expect(
					owner,
					`${name}: "${title}" is used by both ${owner} and ${ladder[i]}`
				).toBeUndefined();
				titleOwner.set(title, ladder[i]);
			}
		});
	}
});
