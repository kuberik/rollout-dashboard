import { describe, it, expect } from 'vitest';
import {
	buildRevisionLedger,
	deployedRevisionCount,
	groupServicesByLabel,
	leadRowsFor,
	lineState,
	matchesRevisionText,
	orderServiceGroups,
	pastRows,
	rankSentence,
	releaseLines,
	repoDeviation,
	resolveRevision,
	restRows,
	revisionLookup,
	rowNamesBuild,
	serviceLedger,
	sortByDeviation,
	type RepoLedger,
	type ReleaseLine,
	type RevisionRow,
	type RevisionSlot,
	type ServiceLedgerGroup,
	type ServiceLedgerLine
} from './revision-ledger';
import type { RevisionCoverage } from './revision-coverage';
import type { Environment, Rollout } from '../../types';

/**
 * The defect these tests are written against, measured on the live cluster:
 * `/versions` printed 16 rows for 11 revisions, and `9f10e49` occupied three
 * of them labelled `NEWEST`, `−1` and `−2` — three ranks for one commit,
 * because the rank was an index into a list of LABEL strings. Its row also
 * claimed `3 apps` while five services carried it.
 *
 * Every assertion below is one half of that: rows are keyed by revision, and
 * the labels hang off the row rather than splitting it.
 */

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
	history: { r: Rel; minutesAgo: number }[],
	extra: Record<string, unknown> = {}
): Rollout {
	return {
		metadata: { name, namespace: ns },
		spec: {},
		status: {
			source: SOURCE,
			// The real API delivers availableReleases OLDEST-FIRST.
			availableReleases: [...releases].reverse(),
			history: history.map((h) => ({
				version: h.r,
				timestamp: new Date(Date.now() - h.minutesAgo * 60_000).toISOString(),
				bakeStatus: 'Succeeded'
			})),
			...extra
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
 * Two services on ONE repo, shipping the same three commits under different
 * label schemes — the exact shape that fragmented the old page.
 *
 *   api  labels them 1.3.0 / 1.2.0 / 1.1.0
 *   web  labels them with the short sha (no semver annotation)
 *
 * `api` is fully converged on the head; `web`'s prod is two builds behind.
 */
function fixture() {
	const A = [rel('aaaaaaa', '1.3.0', 10), rel('bbbbbbb', '1.2.0', 120), rel('ccccccc', '1.1.0', 300)];
	const W = [
		rel('aaaaaaa', undefined, 10),
		rel('bbbbbbb', undefined, 120),
		rel('ccccccc', undefined, 300)
	];
	const rollouts = [
		rollout('api', 'api-dev', A, [{ r: A[0], minutesAgo: 5 }]),
		rollout('api', 'api-prod', A, [{ r: A[0], minutesAgo: 3 }]),
		rollout('web', 'web-dev', W, [{ r: W[0], minutesAgo: 5 }]),
		rollout('web', 'web-prod', W, [
			{ r: W[2], minutesAgo: 200 },
			{ r: W[1], minutesAgo: 250 }
		])
	];
	const environments = [
		environment('api', 'api-dev', 'dev'),
		environment('api', 'api-prod', 'prod'),
		environment('web', 'web-dev', 'dev'),
		environment('web', 'web-prod', 'prod')
	];
	return { rollouts, environments, A, W };
}

describe('buildRevisionLedger', () => {
	it('keys rows by revision, so one commit is ONE row however many labels it has', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		expect(repo.rows).toHaveLength(3);
		expect(repo.rows.map((r) => r.short)).toEqual(['aaaaaaa', 'bbbbbbb', 'ccccccc']);
		// …and the row carries EVERY service, not one per label.
		expect(repo.rows[0].services.map((s) => s.appName)).toEqual(['api', 'web']);
	});

	it('normalises ssh and https forms of one repo into one section', () => {
		const { rollouts, environments } = fixture();
		rollouts[2].status!.source = 'git@github.com:acme/monorepo.git';
		rollouts[3].status!.source = 'git@github.com:acme/monorepo.git';
		expect(buildRevisionLedger(rollouts, environments)).toHaveLength(1);
	});

	it('prints a label only when it differs from the row identifier', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		const head = repo.rows[0];
		expect(head.services.find((s) => s.appName === 'api')!.labelDiffers).toBe(true);
		// `web` labels the build with its own sha — printing it would be the row
		// identifier a second time.
		expect(head.services.find((s) => s.appName === 'web')!.labelDiffers).toBe(false);
	});

	/**
	 * THE GROUPING THAT DELETED A RULE — and with it the `/versions` footer
	 * legend and the detail page's caption. Every group prints its own name,
	 * including the group whose name is the revision's own sha, so a reader
	 * never has to infer anything from an absent label. See
	 * `RevisionLabelGroup`.
	 */
	it('groups services by the name they ship a revision under', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		const head = repo.rows[0];
		expect(head.labelGroups.map((g) => g.label)).toEqual(['1.3.0', head.short]);
		expect(head.labelGroups.map((g) => g.services.map((s) => s.appName))).toEqual([
			['api'],
			['web']
		]);
	});

	it('names the own-sha group in the seven-character form, never the raw 40', () => {
		// A rollout whose artifact tag IS the full revision still ships under the
		// revision — `labelDiffers` says so — and rendering forty characters in
		// an 84px track would push that one row's services off the column.
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		const head = repo.rows[0];
		const own = head.labelGroups.find((g) => g.isOwnSha)!;
		expect(own.label).toBe(head.short);
		expect(own.label).toHaveLength(7);
	});

	it('sinks the revision-own-sha group to the end, so deviations read first', () => {
		const groups = groupServicesByLabel([
			{ appName: 'web', label: 'aaaaaaa', labelDiffers: false } as never,
			{ appName: 'api', label: '1.3.0', labelDiffers: true } as never,
			{ appName: 'jobs', label: 'aaaaaaa', labelDiffers: false } as never,
			{ appName: 'cli', label: '2.3.0', labelDiffers: true } as never
		]);
		expect(groups.map((g) => g.label)).toEqual(['1.3.0', '2.3.0', 'aaaaaaa']);
		expect(groups.map((g) => g.isOwnSha)).toEqual([false, false, true]);
		// Services that share a name collapse onto one group rather than one
		// line each — this is the whole compression, and it is why 40 service
		// lines became 19 on the live cluster.
		expect(groups[2].services.map((s) => s.appName)).toEqual(['web', 'jobs']);
	});

	it('gives a revision nobody renames exactly one group, named for the sha', () => {
		const groups = groupServicesByLabel([
			{ appName: 'a', label: 'ccccccc', labelDiffers: false } as never,
			{ appName: 'b', label: 'ccccccc', labelDiffers: false } as never
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].label).toBe('ccccccc');
		expect(groups[0].isOwnSha).toBe(true);
	});

	/**
	 * The suppression that stops the row printing its own sha twice, 60px
	 * apart. Per-ROW and total, so nothing is hidden beside anything — see
	 * `rowNamesBuild` for why that is a different object from the per-group
	 * `labelDiffers` rule this page used to carry.
	 */
	it('has no name to print when the only group is the revision itself', () => {
		expect(rowNamesBuild({ labelGroups: [{ label: 'ccccccc', isOwnSha: true, services: [] }] })).toBe(
			false
		);
	});

	it('still prints every name when one service renames and another does not', () => {
		// The load-bearing case: absence beside presence is the ambiguity worth
		// paying to avoid, so here the sha group KEEPS its name.
		expect(
			rowNamesBuild({
				labelGroups: [
					{ label: '1.3.0', isOwnSha: false, services: [] },
					{ label: 'aaaaaaa', isOwnSha: true, services: [] }
				]
			})
		).toBe(true);
	});

	it('counts live slots as service x environment, not per label', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		const head = repo.rows[0];
		expect(head.totalSlots).toBe(4); // 2 services x 2 environments
		expect(head.liveSlots).toBe(3); // web-prod is behind
	});

	it('states the scope: rows are the DEPLOYED subset of a larger ladder', () => {
		const { rollouts, environments, A } = fixture();
		// A fourth build exists on the release line but has never deployed.
		const extra = rel('ddddddd', '1.4.0', 1);
		for (const r of rollouts) r.status!.availableReleases!.push(extra as never);
		const [repo] = buildRevisionLedger(rollouts, environments);
		expect(repo.rows).toHaveLength(3);
		expect(repo.knownRevisions).toBe(4);
		expect(A).toHaveLength(3);
	});

	it('puts `not yet in` ONLY on the head, so one lag is not marked N times', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		// `web-prod` is behind the head AND behind row 2. Only the head says so.
		expect(repo.rows[0].notYet.map((s) => `${s.appName}/${s.envName}`)).toEqual(['web/prod']);
		expect(repo.rows[1].notYet).toHaveLength(0);
		expect(repo.rows[2].notYet).toHaveLength(0);
	});

	it('mirrors it on an older revision: the deviation is what has NOT moved on', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		const ccccccc = repo.rows.find((r) => r.short === 'ccccccc')!;
		expect(ccccccc.stillLive.map((s) => `${s.appName}/${s.envName}`)).toEqual(['web/prod']);
		expect(ccccccc.notYet).toHaveLength(0);
	});

	it('attaches the rank to the environment, measured on that service own ladder', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		const slot = repo.rows[0].notYet[0];
		// web/prod runs `ccccccc`, which is rank 2 on web's three-build ladder.
		expect(slot.currentRank).toBe(2);
	});

	it('gives each service its own denominator on the detail table', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		const head = repo.rows[0];
		expect(rankSentence(head.services.find((s) => s.appName === 'api')!)).toEqual({
			rank: 'newest',
			of: 'of 3 builds'
		});
		expect(rankSentence(head.services.find((s) => s.appName === 'web')!)).toEqual({
			rank: 'newest',
			of: 'of 3 builds'
		});
	});

	it('offers a promote to the straggler when no gate objects', () => {
		const { rollouts, environments, W } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		// `web-prod` is two builds behind and the rollout declares no gates, so
		// the offer can succeed and is made. The tag is the GATE KEY form, which
		// is what `ChangeVersionModal` preselects — never the display label.
		expect(repo.rows[0].notYet[0].promoteTag).toBe(W[0].tag);
		// And never on a row that is not the head: promoting backwards is a
		// rollback wearing the wrong word.
		expect(repo.rows[1].notYet).toHaveLength(0);
		expect(repo.rows[2].notYet).toHaveLength(0);
	});

	it('withholds the promote when a gate holds that exact tag back', () => {
		const { rollouts, environments, W } = fixture();
		const prod = rollouts[3];
		prod.status!.releaseCandidates = [W[0], W[1]] as never;
		// The gate publishes an allow-list that does NOT contain the head. This
		// is the live cluster's own shape: `hello-world-manual-approval` allows
		// nothing, so `/versions` offers no promote there either. An offer that
		// will be refused is worse than no offer.
		prod.status!.gates = [{ name: 'approval', passing: true, allowedVersions: [W[1].tag] }] as never;
		expect(buildRevisionLedger(rollouts, environments)[0].rows[0].notYet[0].promoteTag).toBeNull();

		prod.status!.gates = [{ name: 'approval', passing: true, allowedVersions: [W[0].tag] }] as never;
		expect(buildRevisionLedger(rollouts, environments)[0].rows[0].notYet[0].promoteTag).toBe(
			W[0].tag
		);
	});

	it('falls back to the label as the key when no artifact carries a revision', () => {
		const { rollouts, environments } = fixture();
		for (const r of rollouts) {
			for (const rel of r.status!.availableReleases!) delete (rel as { revision?: string }).revision;
			for (const h of r.status!.history!) delete (h.version as { revision?: string }).revision;
		}
		const [repo] = buildRevisionLedger(rollouts, environments);
		// Still a page, rather than an empty one. The two services no longer
		// merge — there is no commit identity left to merge them on.
		expect(repo.rows.length).toBeGreaterThan(0);
	});

	/**
	 * ⭐ ROUND 4a, ITEM A — A ROW IS ABOUT ONE RELEASE, COMPLETING THE HALF-FIX.
	 * `hello-frontend-app` rel-66 and rel-67 share one git revision (a
	 * rollback re-ships a build already released once before under a new
	 * tag). The 2026-09-02 pass fixed the label/rank PAIRING (both now name
	 * rel-67 together) but kept ONE row, which then claimed `NEWEST … held in
	 * N places` about a build that N places were, in fact, RUNNING (under
	 * rel-66). `ServiceCtx.releasesByKey` (this service has TWO releases for
	 * this revision) is what makes `buildRowsForRevision` split it: one row
	 * per release, same revision, each with its own rank and its own truthful
	 * `onIt`.
	 */
	it('splits one row per release when a revision resolves to more than one', () => {
		const older = rel('eeeeeee', '2.66.0-66', 120); // rel-66, running
		const newer = rel('eeeeeee', '2.67.0-67', 10); // rel-67, newer, held — never deployed
		const rollouts = [
			rollout('hello-frontend-app', 'hfa-prod', [newer, older], [{ r: older, minutesAgo: 5 }])
		];
		const environments = [environment('hello-frontend-app', 'hfa-prod', 'prod')];
		const [repo] = buildRevisionLedger(rollouts, environments);
		// TWO rows now — one per release — both about the SAME commit.
		expect(repo.rows).toHaveLength(2);
		expect(new Set(repo.rows.map((r) => r.revision)).size).toBe(1);

		const held = repo.rows.find((r) => r.services[0].label === '2.67.0-67');
		const running = repo.rows.find((r) => r.services[0].label === '2.66.0-66');
		expect(held).toBeTruthy();
		expect(running).toBeTruthy();

		// `NEWEST` (rank 0) belongs to rel-67's OWN row, and nobody is
		// actually on it: `onIt` is false everywhere, never borrowed from the
		// sibling release sharing this revision.
		expect(held!.services[0].rank).toBe(0);
		expect(held!.services[0].slots[0].onIt).toBe(false);
		expect(held!.liveSlots).toBe(0);

		// rel-66's OWN row correctly reads `1 behind`, and the place running
		// it reads `onIt`, on ITS row only.
		expect(running!.services[0].rank).toBe(1);
		expect(running!.services[0].slots[0].onIt).toBe(true);
		expect(running!.liveSlots).toBe(1);
	});

	/**
	 * ⭐ COORDINATOR PASS 2, ITEM C — A NON-AMBIGUOUS SERVICE SHARING THE
	 * SPLIT REVISION GETS EXACTLY ONE ROW, NOT A THIRD OF ITS OWN. Live
	 * regression: `hello-api-app` has ONE release of `9f10e49` (no
	 * ambiguity of its own) while `hello-frontend-app` has two (this
	 * fixture's own split). The first draft unioned every service's own
	 * versions into the split set, so `hello-api-app`'s own version —
	 * never equal to either of `hello-frontend-app`'s — got a THIRD row,
	 * inflating "deployed at least once" by 2 instead of 1 and dropping
	 * `hello-api-app` out of the release line's shared hero. It must
	 * attach to the PRIMARY (best-ranked / newest) split row alone, with
	 * its own label and rank intact, and sit the other split row out
	 * entirely.
	 */
	/**
	 * ⭐ COORDINATOR PASS 2, ITEM C — "DEPLOYED AT LEAST ONCE" DOES NOT GROW
	 * FROM A ROW SPLIT ALONE. `repo.rows.length` is 2 for this fixture (one
	 * per release); `deployedRevisionCount` must still read 1 — one commit,
	 * deployed, however many releases it resolves to.
	 */
	it('deployedRevisionCount counts the COMMIT once, even though the split produced two rows', () => {
		const older = rel('eeeeeee', '2.66.0-66', 120);
		const newer = rel('eeeeeee', '2.67.0-67', 10);
		const rollouts = [
			rollout('hello-frontend-app', 'hfa-prod', [newer, older], [{ r: older, minutesAgo: 5 }])
		];
		const environments = [environment('hello-frontend-app', 'hfa-prod', 'prod')];
		const [repo] = buildRevisionLedger(rollouts, environments);
		expect(repo.rows).toHaveLength(2);
		expect(deployedRevisionCount(repo)).toBe(1);
	});

	it('attaches a non-ambiguous service sharing the split revision to the PRIMARY row only', () => {
		const older = rel('eeeeeee', '2.66.0-66', 120); // rel-66, hello-frontend-app running
		const newer = rel('eeeeeee', '2.67.0-67', 10); // rel-67, hello-frontend-app held
		const apiOwn = rel('eeeeeee', '1.66.0-66', 10); // hello-api-app's OWN, unambiguous release of the same commit
		const rollouts = [
			rollout('hello-frontend-app', 'hfa-prod', [newer, older], [{ r: older, minutesAgo: 5 }]),
			rollout('hello-api-app', 'api-prod', [apiOwn], [{ r: apiOwn, minutesAgo: 5 }])
		];
		const environments = [
			environment('hello-frontend-app', 'hfa-prod', 'prod'),
			environment('hello-api-app', 'api-prod', 'prod')
		];
		const [repo] = buildRevisionLedger(rollouts, environments);
		// Still exactly TWO rows for the shared revision — the split is
		// keyed on `hello-frontend-app`'s own two releases only.
		const sameRevisionRows = repo.rows.filter((r) => r.revision === repo.rows[0].revision);
		expect(sameRevisionRows).toHaveLength(2);

		const held = sameRevisionRows.find((r) =>
			r.services.some((s) => s.appName === 'hello-frontend-app' && s.label === '2.67.0-67')
		)!;
		const running = sameRevisionRows.find((r) =>
			r.services.some((s) => s.appName === 'hello-frontend-app' && s.label === '2.66.0-66')
		)!;
		expect(held).toBeTruthy();
		expect(running).toBeTruthy();

		// hello-api-app rides with the PRIMARY (held, rank-0) row only —
		// live there (it is not held), with its own label untouched.
		const apiOnHeld = held.services.find((s) => s.appName === 'hello-api-app');
		expect(apiOnHeld?.label).toBe('1.66.0-66');
		expect(apiOnHeld?.liveSlots).toBe(1);

		// …and does not appear a second time on the OTHER split row.
		expect(running.services.some((s) => s.appName === 'hello-api-app')).toBe(false);
	});

	it('keeps label and rank matched when a revision has only one release', () => {
		// The ordinary case must stay byte-identical: nothing to disambiguate.
		const { rollouts, environments, A } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		const head = repo.rows[0];
		const api = head.services.find((s) => s.appName === 'api')!;
		expect(api.rank).toBe(0);
		expect(api.label).toBe(A[0].version);
	});
});

describe('resolveRevision', () => {
	it('resolves a short sha, a slug and the full revision to one row', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		const full = repo.rows[0].revision;
		expect(resolveRevision(repo, 'aaaaaaa')).toBe(full);
		expect(resolveRevision(repo, full.slice(0, 12))).toBe(full);
		expect(resolveRevision(repo, full)).toBe(full);
	});

	it('resolves a pre-migration label link, so old URLs keep working', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		expect(resolveRevision(repo, '1.3.0')).toBe(repo.rows[0].revision);
	});

	it('returns null rather than guessing', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		expect(resolveRevision(repo, 'deadbee')).toBeNull();
		expect(resolveRevision(null, 'aaaaaaa')).toBeNull();
	});
});

describe('a repo with zero deployed builds still appears (REVISIONS-2026-09-05)', () => {
	it('keeps a repo whose services have never deployed anything, as long as it is KNOWN', () => {
		const A = [rel('aaaaaaa', '1.3.0', 10), rel('bbbbbbb', '1.2.0', 120)];
		// A rollout that PUBLISHES a release list but has no `history` at all —
		// the shape of a brand-new app nobody has promoted yet.
		const rollouts = [rollout('api', 'api-dev', A, [])];
		const environments = [environment('api', 'api-dev', 'dev')];
		const ledgers = buildRevisionLedger(rollouts, environments);
		expect(ledgers).toHaveLength(1);
		expect(ledgers[0].rows).toHaveLength(0);
		expect(ledgers[0].knownRevisions).toBe(2);
		expect(ledgers[0].pending).toHaveLength(2);
	});

	it('still drops a repo with nothing known at all', () => {
		// Belt and braces: `groupRolloutsByApp` should never hand back a group
		// whose ladder is entirely empty, but the ledger builder does not rely
		// on that alone.
		expect(buildRevisionLedger([], [])).toHaveLength(0);
	});
});

describe('serviceLedger', () => {
	it('gives every service one line per build it is actually live on', () => {
		const { rollouts, environments } = fixture();
		const [repo] = buildRevisionLedger(rollouts, environments);
		const groups = serviceLedger(repo);
		expect(groups.map((g) => g.appName)).toEqual(['api', 'web']);
		// `api` is fully converged on the head everywhere — one line.
		const api = groups.find((g) => g.appName === 'api')!;
		expect(api.lines).toHaveLength(1);
		expect(api.lines[0].rank).toBe(0);
		expect(api.lines[0].slots.map((s) => s.envName)).toEqual(['dev', 'prod']);
		// `web` is on the head in dev but two builds behind in prod — TWO
		// lines, one per build it is actually running, not one row that tries
		// to state both ranks at once.
		const web = groups.find((g) => g.appName === 'web')!;
		expect(web.lines).toHaveLength(2);
		expect(web.lines.map((l) => l.rank)).toEqual([0, 2]);
		expect(web.lines.find((l) => l.rank === 0)!.slots.map((s) => s.envName)).toEqual(['dev']);
		expect(web.lines.find((l) => l.rank === 2)!.slots.map((s) => s.envName)).toEqual(['prod']);
	});

	it('gives a service that has never deployed an empty group, not a missing one', () => {
		const A = [rel('aaaaaaa', '1.3.0', 10)];
		const rollouts = [rollout('api', 'api-dev', A, [])];
		const environments = [environment('api', 'api-dev', 'dev')];
		const [repo] = buildRevisionLedger(rollouts, environments);
		const groups = serviceLedger(repo);
		expect(groups).toHaveLength(1);
		expect(groups[0].appName).toBe('api');
		expect(groups[0].lines).toHaveLength(0);
	});
});

/** Just enough of `RevisionCoverage`'s shape for `repoDeviation` to read. */
/**
 * ⭐ COORDINATOR PASS 2, ITEM B — `slot.onRevision` IS PART OF THE FIXTURE
 * NOW. `repoDeviation`'s `held` bucket reads `notYet` slots' raw
 * `RevisionSlot.onRevision` (same commit, sibling release) to tell a hold
 * apart from ordinary lag — see that function's own doc comment. Defaults
 * to `false` (ordinary lag, the common case every existing fixture below
 * means) so only a test that explicitly asks for the sibling-release case
 * has to say so.
 */
function coverage(
	buckets: {
		key: string;
		slots: { appName: string; onOwnRelease?: boolean; onRevision?: boolean }[];
	}[]
): RevisionCoverage {
	const withSlot = buckets.map((b) => ({
		...b,
		slots: b.slots.map((s) => ({ ...s, slot: { onRevision: s.onRevision ?? false } }))
	}));
	return { liveCount: 0, totalCount: 0, reachable: true, buckets: withSlot } as unknown as RevisionCoverage;
}

describe('repoDeviation — craft review item 3 (lead with the deviation)', () => {
	it('ranks a failing head above everything else', () => {
		const cov = coverage([{ key: 'failing', slots: [{ appName: 'api' }] }]);
		expect(repoDeviation({ pending: [] }, cov)).toEqual({
			severity: 3,
			chip: { role: 'failing', label: 'failing', count: 1 },
			backlog: 0
		});
	});

	it('ranks a held build (live but not on its own release) as severity 2, spelled `held` not `alarm`', () => {
		// round-3 addendum B: `held` is not an alarm — `/rollouts` already
		// spells this fact `Chip role="held"`, the quiet TRAILING-orange
		// outline chip, never the amber `alarm` FILL reserved for `stuck`.
		const cov = coverage([
			{
				key: 'live',
				slots: [
					{ appName: 'api', onOwnRelease: false },
					{ appName: 'web', onOwnRelease: true }
				]
			}
		]);
		expect(repoDeviation({ pending: [] }, cov)).toEqual({
			severity: 2,
			chip: { role: 'held', label: '1 held', count: 1 },
			backlog: 0
		});
	});

	it('counts distinct SERVICES behind, not places', () => {
		const cov = coverage([
			{
				key: 'notYet',
				slots: [{ appName: 'api' }, { appName: 'api' }, { appName: 'web' }]
			}
		]);
		expect(repoDeviation({ pending: [] }, cov)).toEqual({
			severity: 1,
			chip: { role: 'rank', label: '2 behind', count: 2 },
			backlog: 0
		});
	});

	/**
	 * ⭐ COORDINATOR PASS 2, ITEM B — A HELD SIBLING RELEASE READS `held`,
	 * NEVER `behind`, EVEN THOUGH ITS PLACES ARE IN THE `notYet` BUCKET.
	 * Once a revision splits one row per release, the head row for the
	 * HELD release has nobody `live` on it — the places running the
	 * sibling release land in `notYet` with `slot.onRevision: true`. Live
	 * regression: `hello-frontend-app`'s held `9f10e49` read `1 BEHIND` in
	 * the collapsed header while its own hero said `held in 3 places` two
	 * scrolls down — same rollout, two verdicts.
	 */
	it('reads `held`, not `behind`, when the notYet places are on the SAME commit’s sibling release', () => {
		const cov = coverage([
			{
				key: 'notYet',
				slots: [
					{ appName: 'hello-frontend-app', onRevision: true },
					{ appName: 'hello-frontend-app', onRevision: true },
					{ appName: 'hello-frontend-app', onRevision: true }
				]
			}
		]);
		expect(repoDeviation({ pending: [] }, cov)).toEqual({
			severity: 2,
			chip: { role: 'held', label: '3 held', count: 3 },
			backlog: 0
		});
	});

	it('keeps a MIX of held (onRevision) and genuine lag (not onRevision) as two separate counts', () => {
		const cov = coverage([
			{
				key: 'notYet',
				slots: [
					{ appName: 'hello-frontend-app', onRevision: true },
					{ appName: 'hello-multi-app', onRevision: false }
				]
			}
		]);
		// The held one is `held`; a repo with ANY held places leads with
		// that severity — `behind` never mixes into the same chip.
		expect(repoDeviation({ pending: [] }, cov)).toEqual({
			severity: 2,
			chip: { role: 'held', label: '1 held', count: 1 },
			backlog: 0
		});
	});

	it('is severity 0 with no chip when nothing deviates', () => {
		const cov = coverage([{ key: 'live', slots: [{ appName: 'api', onOwnRelease: true }] }]);
		expect(repoDeviation({ pending: [] }, cov)).toEqual({ severity: 0, chip: null, backlog: 0 });
	});

	it('is severity 0 with the pending backlog counted, when there is no head at all', () => {
		expect(repoDeviation({ pending: [{} as never, {} as never] }, null)).toEqual({
			severity: 0,
			chip: null,
			backlog: 2
		});
	});
});

describe('sortByDeviation', () => {
	function mk(lastDeployMs: number): RepoLedger {
		return { lastDeployMs } as unknown as RepoLedger;
	}

	it('sorts failing > held > behind > none', () => {
		const items = [
			{ repo: mk(300), deviation: { severity: 0 as const, chip: null, backlog: 5 } },
			{ repo: mk(200), deviation: { severity: 3 as const, chip: null, backlog: 0 } },
			{ repo: mk(100), deviation: { severity: 1 as const, chip: null, backlog: 0 } }
		];
		expect(sortByDeviation(items).map((i) => i.deviation.severity)).toEqual([3, 1, 0]);
	});

	it('breaks a severity tie on backlog, then on recency', () => {
		const items = [
			{ repo: mk(100), deviation: { severity: 0 as const, chip: null, backlog: 1 } },
			{ repo: mk(200), deviation: { severity: 0 as const, chip: null, backlog: 1 } },
			{ repo: mk(999), deviation: { severity: 0 as const, chip: null, backlog: 0 } }
		];
		// Both backlog:1 repos outrank the backlog:0 one despite its later
		// deploy; between the tied pair, the more recently deployed leads.
		expect(sortByDeviation(items).map((i) => i.repo.lastDeployMs)).toEqual([200, 100, 999]);
	});
});

/**
 * ⭐ A REPOSITORY IS NOT ONE RELEASE LINE — round 3 §1. Measured on the live
 * fleet: `kuberik-testing` holds 5 services, and `9f10e49` is the newest
 * build only for `hello-api-app`/`hello-frontend-app`; the other three share
 * an entirely different stream. `releaseLines` is a pure function over
 * `RevisionRow.services[].rank`, so these fixtures build the minimal shape
 * it reads rather than a full ledger.
 */
describe('releaseLines — round 3 §1 (a repository is not one release line)', () => {
	function row(
		revision: string,
		createdMs: number,
		services: { appName: string; rank: number | null }[]
	): RevisionRow {
		return { revision, createdMs, services } as unknown as RevisionRow;
	}

	it('groups services by the build their OWN ladder currently heads with, not by repo', () => {
		const repo: Pick<RepoLedger, 'rows' | 'pending'> = {
			rows: [
				row('fffffff', 100, [
					{ appName: 'hello-api-app', rank: 0 },
					{ appName: 'hello-frontend-app', rank: 0 },
					// A third service also carries this revision, but it is NOT
					// this service's own newest — must not join the line on that
					// alone.
					{ appName: 'hello-multi-app', rank: 1 }
				]),
				row('9999999', 40, [{ appName: 'hello-multi-app', rank: 0 }])
			],
			pending: []
		};
		const lines = releaseLines(repo);
		expect(lines).toHaveLength(2);
		const byHead = new Map(lines.map((l) => [l.headRevision, l.services]));
		expect(byHead.get('fffffff')).toEqual(['hello-api-app', 'hello-frontend-app']);
		expect(byHead.get('9999999')).toEqual(['hello-multi-app']);
	});

	it('gives a service with no placeable rank anywhere its own line, never a guessed merge', () => {
		const repo: Pick<RepoLedger, 'rows' | 'pending'> = {
			rows: [
				row('fffffff', 100, [
					{ appName: 'api', rank: 0 },
					{ appName: 'orphan', rank: null }
				])
			],
			pending: []
		};
		const lines = releaseLines(repo);
		expect(lines).toHaveLength(2);
		const orphanLine = lines.find((l) => l.services.includes('orphan'));
		expect(orphanLine?.headRevision).toBeNull();
		expect(orphanLine?.services).toEqual(['orphan']);
	});

	it('two unranked services never merge into one line by coincidence', () => {
		const repo: Pick<RepoLedger, 'rows' | 'pending'> = {
			rows: [
				row('fffffff', 100, [
					{ appName: 'orphan-a', rank: null },
					{ appName: 'orphan-b', rank: null }
				])
			],
			pending: []
		};
		expect(releaseLines(repo)).toHaveLength(2);
	});

	it('orders lines by their own head build’s creation time, newest first', () => {
		const repo: Pick<RepoLedger, 'rows' | 'pending'> = {
			rows: [
				row('older', 100, [{ appName: 'a', rank: 0 }]),
				row('newer', 500, [{ appName: 'b', rank: 0 }])
			],
			pending: []
		};
		expect(releaseLines(repo).map((l) => l.headRevision)).toEqual(['newer', 'older']);
	});

	/**
	 * ⭐ COORDINATOR PASS 2, ITEM D — MAX createdMs PER REVISION, NOT
	 * LAST-WRITE-WINS. A split revision (a held sibling release) puts TWO
	 * rows in `allRows` for the SAME key with different `createdMs`. If the
	 * OLDER one is iterated after the newer (exactly how `repo.rows`' own
	 * `byRecency` sort — newest first — lays them out, so the held row
	 * comes BEFORE the running one), a plain `.set()` per row keeps the
	 * older timestamp and this line sorts as if it were stale.
	 */
	it('uses the MAX createdMs across a split revision’s several rows, not whichever is iterated last', () => {
		const repo: Pick<RepoLedger, 'rows' | 'pending'> = {
			rows: [
				// Held row first (byRecency: newest-created first) — createdMs 500.
				row('9f10e49', 500, [{ appName: 'hello-frontend-app', rank: 0 }]),
				// Running row second, OLDER createdMs — must not overwrite the 500 above.
				row('9f10e49', 200, [{ appName: 'hello-frontend-app', rank: 1 }]),
				row('064b655', 300, [{ appName: 'hello-multi-app', rank: 0 }])
			],
			pending: []
		};
		// The split revision's line (true head createdMs 500) sorts BEFORE
		// the other line (300) — a stale 200 would have sorted it after.
		expect(releaseLines(repo).map((l) => l.headRevision)).toEqual(['9f10e49', '064b655']);
	});

	it('reads pending (never-deployed) rows too, so an undeployed line head is still found', () => {
		const repo: Pick<RepoLedger, 'rows' | 'pending'> = {
			rows: [],
			pending: [row('fffffff', 100, [{ appName: 'api', rank: 0 }])]
		};
		const lines = releaseLines(repo);
		expect(lines).toEqual([{ headRevision: 'fffffff', services: ['api'] }]);
	});

	it('end to end: buildRevisionLedger’s own two-line fixture partitions correctly', () => {
		// Line 1 — api + web share revision `fffffff` as their own newest.
		const L1 = [rel('fffffff', '9.9.0', 5)];
		// Line 2 — jobs shares a completely different newest, `9999999`.
		const L2 = [rel('9999999', '3.3.0', 50)];
		const rollouts = [
			rollout('api', 'api-dev', L1, [{ r: L1[0], minutesAgo: 5 }]),
			rollout('web', 'web-dev', L1, [{ r: L1[0], minutesAgo: 5 }]),
			rollout('jobs', 'jobs-dev', L2, [{ r: L2[0], minutesAgo: 5 }])
		];
		const environments = [
			environment('api', 'api-dev', 'dev'),
			environment('web', 'web-dev', 'dev'),
			environment('jobs', 'jobs-dev', 'dev')
		];
		const [repo] = buildRevisionLedger(rollouts, environments);
		const lines = releaseLines(repo);
		expect(lines.map((l) => l.services)).toEqual([
			['api', 'web'],
			['jobs']
		]);
	});
});

/**
 * ⭐ STATE IN WORDS, THE RIGHT KIND, THE RIGHT HUE — round 3 §3. Read off the
 * SAME primitives `rollout-cards.ts` (the home cards) reads, so this page's
 * word cannot disagree with `/`'s for one rollout.
 */
describe('lineState — round 3 §3 (state in words, right kind, right hue)', () => {
	const now = new Date('2026-01-01T00:00:00Z');
	function slot(rollout: unknown): RevisionSlot {
		return { cell: { rollout } } as unknown as RevisionSlot;
	}
	function line(slots: RevisionSlot[]): Pick<ServiceLedgerLine, 'slots'> {
		return { slots };
	}

	it('draws nothing for the steady norm', () => {
		const r = {
			status: { history: [{ bakeStatus: 'Succeeded', version: { tag: 'v1', version: '1.0.0' } }] }
		};
		expect(lineState(line([slot(r)]), now)).toBeNull();
	});

	it('draws FAILING (red) above everything else', () => {
		const r = {
			status: { history: [{ bakeStatus: 'Failed', version: { tag: 'v1', version: '1.0.0' } }] },
			spec: { wantedVersion: '1.2.3' } // also pinned — failing still wins
		};
		expect(lineState(line([slot(r)]), now)?.role).toBe('failing');
	});

	it('draws STUCK (amber alarm) before HELD', () => {
		const r = {
			status: {
				history: [
					{
						bakeStatus: 'InProgress',
						version: { tag: 'v1', version: '1.0.0' },
						timestamp: new Date(now.getTime() - 2 * 3600_000).toISOString()
					}
				],
				releaseCandidates: [{ tag: 'v2', version: '2.0.0' }],
				gates: [{ name: 'g', passing: true, allowedVersions: [] }]
			}
		};
		expect(lineState(line([slot(r)]), now)?.role).toBe('alarm');
	});

	it('draws HELD (the quiet orange, `role: held`) when a rule refuses every candidate', () => {
		const r = {
			status: {
				history: [{ bakeStatus: 'Succeeded', version: { tag: 'v1', version: '1.0.0' } }],
				releaseCandidates: [{ tag: 'v2', version: '2.0.0' }],
				gates: [{ name: 'g', passing: true, allowedVersions: [] }]
			}
		};
		const state = lineState(line([slot(r)]), now);
		expect(state?.role).toBe('held');
		expect(state?.label).toBe('held');
		// The fixture's own candidate carries no `revision` — honest null
		// rather than a guessed sha.
		expect(state?.holdOf).toBeNull();
	});

	/**
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 6 — `holdOf` NAMES THE BLOCKED
	 * CANDIDATE, NOT THE RUNNING LINE. The old row spelled a `held` line as
	 * `HELD <this line's own running sha>` — this is the fixture proving the
	 * candidate `promotionBlock` actually found blocked is what `holdOf`
	 * carries, read off the SAME rollout, so the two can never name
	 * different builds.
	 */
	it('holdOf names the blocked candidate — the sha AND the label when they differ', () => {
		const r = {
			status: {
				history: [{ bakeStatus: 'Succeeded', version: { tag: 'v1', version: '1.0.0' } }],
				releaseCandidates: [
					{ tag: 'v2', version: '2.67.0-67', revision: `${'a'.repeat(40)}` }
				],
				gates: [{ name: 'g', passing: true, allowedVersions: [] }]
			}
		};
		const state = lineState(line([slot(r)]), now);
		expect(state?.role).toBe('held');
		expect(state?.holdOf).toEqual({ short: 'aaaaaaa', label: '2.67.0-67' });
	});

	it('holdOf drops the label when it is the same as the sha — no redundant second value', () => {
		const r = {
			status: {
				history: [{ bakeStatus: 'Succeeded', version: { tag: 'v1', version: '1.0.0' } }],
				releaseCandidates: [{ tag: 'v2', revision: `${'b'.repeat(40)}` }],
				gates: [{ name: 'g', passing: true, allowedVersions: [] }]
			}
		};
		const state = lineState(line([slot(r)]), now);
		expect(state?.holdOf).toEqual({ short: 'bbbbbbb', label: null });
	});

	it('draws PINNED (neutral `unranked`) — a person’s choice, never amber', () => {
		const r = {
			status: { history: [{ bakeStatus: 'Succeeded', version: { tag: 'v1', version: '1.0.0' } }] },
			spec: { wantedVersion: '1.2.3' }
		};
		const state = lineState(line([slot(r)]), now);
		expect(state).toEqual({
			role: 'unranked',
			label: 'pinned',
			title: 'Pinned to 1.2.3 — automatic deploys are paused until the pin is cleared.',
			holdOf: null
		});
	});

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 1 (IN-FLIGHT ON THE LEDGER ROW). Measured
	 * live during a real canary: the hero correctly read `8 live · 1
	 * deploying` while the ledger row for the same service showed no sign
	 * that one place was mid-canary at all — `lineState` never had a branch
	 * for `Deploying`/`InProgress`, so a line whose newest bake had not
	 * settled yet fell all the way through to `null` (drawn as steady) or, if
	 * a pin/hold happened to be set too, printed THAT instead of the more
	 * urgent, currently-happening fact.
	 */
	it('draws DEPLOYING (blue) when the newest bake is actively going out, fresh enough to not be stuck', () => {
		const r = {
			status: {
				history: [
					{
						bakeStatus: 'Deploying',
						version: { tag: 'v2', version: '2.0.0' },
						timestamp: new Date(now.getTime() - 5 * 60_000).toISOString() // 5m ago
					}
				]
			}
		};
		const state = lineState(line([slot(r)]), now);
		expect(state).toEqual({
			role: 'deploying',
			label: 'deploying',
			title: 'The new version is still going out',
			holdOf: null
		});
	});

	it('draws CHECKING (yellow, the bake-window word) for a fresh InProgress bake', () => {
		const r = {
			status: {
				history: [
					{
						bakeStatus: 'InProgress',
						version: { tag: 'v2', version: '2.0.0' },
						timestamp: new Date(now.getTime() - 5 * 60_000).toISOString() // 5m ago
					}
				]
			}
		};
		const state = lineState(line([slot(r)]), now);
		expect(state).toEqual({
			role: 'checking',
			label: 'checking',
			title: 'The new version is live and is being watched before the deploy counts as done',
			holdOf: null
		});
	});

	it('DEPLOYING outranks HELD and PINNED — an active bake is the more urgent, more current fact', () => {
		const heldAndDeploying = {
			status: {
				history: [
					{
						bakeStatus: 'Deploying',
						version: { tag: 'v2', version: '2.0.0' },
						timestamp: new Date(now.getTime() - 5 * 60_000).toISOString()
					}
				],
				releaseCandidates: [{ tag: 'v3', version: '3.0.0' }],
				gates: [{ name: 'g', passing: true, allowedVersions: [] }]
			},
			spec: { wantedVersion: '2.0.0' } // also pinned
		};
		expect(lineState(line([slot(heldAndDeploying)]), now)?.role).toBe('deploying');
	});

	it('FAILING and STUCK still outrank DEPLOYING/CHECKING — those are real problems, an in-flight bake is not', () => {
		const failingWhileDeploying = {
			status: {
				history: [
					{
						bakeStatus: 'Failed',
						version: { tag: 'v2', version: '2.0.0' },
						timestamp: new Date(now.getTime() - 5 * 60_000).toISOString()
					}
				]
			}
		};
		expect(lineState(line([slot(failingWhileDeploying)]), now)?.role).toBe('failing');

		const stuckInProgress = {
			status: {
				history: [
					{
						bakeStatus: 'InProgress',
						version: { tag: 'v2', version: '2.0.0' },
						timestamp: new Date(now.getTime() - 2 * 3600_000).toISOString() // 2h ago — past the 1h threshold
					}
				]
			}
		};
		expect(lineState(line([slot(stuckInProgress)]), now)?.role).toBe('alarm');
	});
});

/**
 * ⭐ DEVIATION-FIRST ORDERING — ROUND SIX §6. Extracted out of `/revisions`'
 * own template so the comparator can be tested without mounting the page.
 * The fixture below is chosen so alphabetical order and deviation order
 * DISAGREE — `aaa-app` sorts first alphabetically and `zzz-app` sorts first
 * on deviation (it is pinned) — which is the only shape that can catch a
 * regression to a bare `localeCompare`.
 */
describe('orderServiceGroups — round 3 addendum C, extracted (round six §6)', () => {
	const now = new Date('2026-01-01T00:00:00Z');

	function slot(rollout: unknown): RevisionSlot {
		return { cell: { rollout } } as unknown as RevisionSlot;
	}
	function line(slots: RevisionSlot[]): ServiceLedgerLine {
		return {
			appName: 'x',
			revision: 'aaaaaaa',
			rowKey: `${'aaaaaaa'}#x`,
			short: 'aaaaaaa',
			rank: 0,
			ladderLength: 1,
			slots
		};
	}
	function group(appName: string, lines: ServiceLedgerLine[]): ServiceLedgerGroup {
		return { appName, lines };
	}

	const steadyRollout = {
		status: { history: [{ bakeStatus: 'Succeeded', version: { tag: 'v1', version: '1.0.0' } }] }
	};
	const pinnedRollout = {
		status: { history: [{ bakeStatus: 'Succeeded', version: { tag: 'v1', version: '1.0.0' } }] },
		spec: { wantedVersion: '1.2.3' }
	};

	it('puts the deviating service first even though it sorts LAST alphabetically', () => {
		const groups = [
			group('aaa-app', [line([slot(steadyRollout)])]),
			group('zzz-app', [line([slot(pinnedRollout)])])
		];
		const ordered = orderServiceGroups(groups, { now });
		expect(ordered.map((g) => g.appName)).toEqual(['zzz-app', 'aaa-app']);
	});

	it('two steady services fall back to alphabetical order', () => {
		const groups = [
			group('zzz-app', [line([slot(steadyRollout)])]),
			group('aaa-app', [line([slot(steadyRollout)])])
		];
		const ordered = orderServiceGroups(groups, { now });
		expect(ordered.map((g) => g.appName)).toEqual(['aaa-app', 'zzz-app']);
	});

	it('a service with no lines at all (never deployed) is steady, not deviating', () => {
		const groups = [group('zzz-app', []), group('aaa-app', [line([slot(pinnedRollout)])])];
		const ordered = orderServiceGroups(groups, { now });
		expect(ordered.map((g) => g.appName)).toEqual(['aaa-app', 'zzz-app']);
	});

	it('on a multi-line repo, a service’s own deviation cannot jump it ahead of an earlier line', () => {
		// `zzz-app` is on line 0 and steady; `aaa-app` is on line 1 and pinned.
		// Alphabetical order alone would put `aaa-app` first; deviation order
		// alone would too — but the RELEASE LINE takes priority over both, so
		// line 0's `zzz-app` still leads.
		const groups = [
			group('aaa-app', [line([slot(pinnedRollout)])]),
			group('zzz-app', [line([slot(steadyRollout)])])
		];
		const ordered = orderServiceGroups(groups, {
			now,
			lineIndexOf: (appName) => (appName === 'zzz-app' ? 0 : 1)
		});
		expect(ordered.map((g) => g.appName)).toEqual(['zzz-app', 'aaa-app']);
	});
});

/**
 * ⭐ OPERATOR-WALK FINDING 1 (2026-09-09, BLOCKING) — `/revisions?q=2.67.0-67`
 * said "1 build matches" in the head band (which filters `RevisionRow`s,
 * checking `labelGroups`) while every repository card said "no match" (the
 * per-service ledger filtered its `ServiceLedgerLine`s with a narrower
 * predicate that never checked the label). `matchesRevisionText` is the one
 * predicate both a row and a line now go through — a line via
 * `revisionLookup`, which resolves it back to the row that carries the
 * labels a bare `ServiceLedgerLine` does not.
 */
describe('matchesRevisionText / revisionLookup — finding 1 (label search must reach the ledger)', () => {
	function labelledRow(
		revision: string,
		short: string,
		labels: string[]
	): RevisionRow {
		return {
			revision,
			short,
			labelGroups: labels.map((label) => ({ label, isOwnSha: false, services: [] }))
		} as unknown as RevisionRow;
	}

	it('matches a bare sha prefix', () => {
		const row = labelledRow('9f10e494d5601111', '9f10e49', []);
		expect(matchesRevisionText(row, '9f10e49')).toBe(true);
		expect(matchesRevisionText(row, '9f10e4')).toBe(true);
		expect(matchesRevisionText(row, 'zzzzzzz')).toBe(false);
	});

	it('matches a release LABEL the sha alone does not contain', () => {
		const row = labelledRow('9f10e494d5601111', '9f10e49', ['2.67.0-67']);
		expect(matchesRevisionText(row, '2.67.0-67')).toBe(true);
		expect(matchesRevisionText(row, '2.67.0')).toBe(true);
	});

	/**
	 * ⭐ LANE 9, ROUND 11 QA, ITEM 9 — `matchServiceNames: false` DROPS THE
	 * SIBLING-NAME CLAUSE, NEVER THE ROW'S OWN SHA/LABEL. Default `true`
	 * (every existing call above stays byte-identical); `false` is
	 * `RepoLedgerCard`'s own per-service ledger line, which must not let a
	 * query matching one service's name (`hello-api-app`) also match a
	 * SIBLING service's line sharing the same row (`hello-frontend-app`).
	 */
	it('matchServiceNames: false drops the sibling-service-name clause, keeps sha/label', () => {
		const row = {
			revision: '9f10e494d5601111',
			short: '9f10e49',
			labelGroups: [{ label: '2.67.0-67', isOwnSha: false, services: [] }],
			services: [{ appName: 'hello-api-app' }, { appName: 'hello-frontend-app' }]
		} as unknown as RevisionRow;
		// Sibling name match: allowed by default, dropped when disabled.
		expect(matchesRevisionText(row, 'hello-api')).toBe(true);
		expect(matchesRevisionText(row, 'hello-api', false)).toBe(false);
		// The row's own sha/label still match either way.
		expect(matchesRevisionText(row, '9f10e49', false)).toBe(true);
		expect(matchesRevisionText(row, '2.67.0-67', false)).toBe(true);
	});

	it('empty query matches everything', () => {
		const row = labelledRow('9f10e494d5601111', '9f10e49', []);
		expect(matchesRevisionText(row, '')).toBe(true);
		expect(matchesRevisionText(row, '   ')).toBe(true);
	});

	it('revisionLookup resolves a ServiceLedgerLine (no labelGroups of its own) back to its row, so the SAME query matches both', () => {
		const repo: Pick<RepoLedger, 'rows' | 'pending'> = {
			rows: [labelledRow('9f10e494d5601111', '9f10e49', ['2.67.0-67'])],
			pending: []
		};
		const lookup = revisionLookup(repo);
		const line = { revision: '9f10e494d5601111', short: '9f10e49' } as unknown as ServiceLedgerLine;

		// The defect this regression test pins: the OLD `lineMatchesSearch`
		// checked only `revision`/`short` — exactly what a bare line offers,
		// with no label — and that is why it missed a label-only query.
		const oldLineOnlyPredicate = (q: string) =>
			line.revision.toLowerCase().startsWith(q.toLowerCase()) ||
			line.short.toLowerCase().includes(q.toLowerCase());
		expect(oldLineOnlyPredicate('2.67.0-67')).toBe(false);

		// The fix: resolve the line's revision back to the row(s) that carry
		// the label, then check THOSE with the one shared predicate.
		const resolved = lookup.get(line.revision);
		expect(resolved).toBeDefined();
		expect(resolved!.some((row) => matchesRevisionText(row, '2.67.0-67'))).toBe(true);
	});

	/**
	 * ⭐ THE BLOCKING DEFECT, ONE LAYER DOWN. Reproduced live against the
	 * dev cluster (2026-09-09): searching `2.67.0` still said "no match" on
	 * `kuberik-testing`'s own card even after the first fix landed, because
	 * `9f10e49` resolves to TWO rows here (the running `1.66.0-66` release
	 * and the held `2.67.0-67` sibling) — a `Map<string, RevisionRow>`
	 * keyed by the bare revision string can hold only one of them, and
	 * whichever lost the slot had its own label silently unreachable. This
	 * is why `revisionLookup` returns an ARRAY per revision.
	 */
	it('a revision split into two rows (a held sibling release) — the lookup keeps BOTH, and either one’s label matches', () => {
		const repo: Pick<RepoLedger, 'rows' | 'pending'> = {
			rows: [
				labelledRow('9f10e494d5601111', '9f10e49', ['1.66.0-66']),
				labelledRow('9f10e494d5601111', '9f10e49', ['2.67.0-67'])
			],
			pending: []
		};
		const lookup = revisionLookup(repo);
		const rows = lookup.get('9f10e494d5601111');
		expect(rows).toHaveLength(2);
		expect(rows!.some((r) => matchesRevisionText(r, '2.67.0-67'))).toBe(true);
		expect(rows!.some((r) => matchesRevisionText(r, '1.66.0-66'))).toBe(true);
	});
});

describe('leadRowsFor / restRows / pastRows — ported from the route (round 11, lane 2)', () => {
	function row(
		revision: string,
		createdMs: number,
		lastDeployMs: number,
		liveSlots: number,
		services: { appName: string; rank: number | null }[]
	): RevisionRow {
		return { revision, createdMs, lastDeployMs, liveSlots, services } as unknown as RevisionRow;
	}

	it('leadRowsFor picks each line’s own newest DEPLOYED row, not its absolute ladder head', () => {
		const repo: Pick<RepoLedger, 'rows'> = {
			rows: [
				row('newest', 200, 200, 1, [{ appName: 'api', rank: 0 }]),
				row('deployed-head', 100, 100, 1, [{ appName: 'api', rank: 1 }])
			]
		};
		const lines: ReleaseLine[] = [{ headRevision: 'newest', services: ['api'] }];
		// `newest` is deployed (rows[0]) and is on this line, so it leads.
		expect(leadRowsFor(repo, lines).map((r) => r.revision)).toEqual(['newest']);
	});

	it('restRows/pastRows exclude the lines’ own head revisions and split on liveSlots', () => {
		const repo: Pick<RepoLedger, 'rows'> = {
			rows: [
				row('head', 300, 300, 1, [{ appName: 'api', rank: 0 }]),
				row('still-live', 200, 250, 1, [{ appName: 'api', rank: 1 }]),
				row('retired', 100, 150, 0, [{ appName: 'api', rank: 2 }])
			]
		};
		const heads = new Set(['head']);
		expect(restRows(repo, heads).map((r) => r.revision)).toEqual(['still-live']);
		expect(pastRows(repo, heads).map((r) => r.revision)).toEqual(['retired']);
	});

	it('pastRows sorts by lastDeployMs, newest first — not by creation time', () => {
		const repo: Pick<RepoLedger, 'rows'> = {
			rows: [
				row('a', 500, 100, 0, [{ appName: 'api', rank: 1 }]),
				row('b', 100, 500, 0, [{ appName: 'api', rank: 2 }])
			]
		};
		expect(pastRows(repo, new Set()).map((r) => r.revision)).toEqual(['b', 'a']);
	});
});

describe('RevisionRow.key — two rows may share a revision (2026-09-10 each_key_duplicate)', () => {
	it('rows for two releases of one revision get distinct keys and ledger lines carry them', () => {
		// hello-frontend-app: rel-66 (prod) and rel-67 (dev) are the same commit
		// 9f10e49 — the shape that threw each_key_duplicate on /revisions once a
		// third release (rel-68, another sha) made dev and prod diverge.
		const r66 = rel('9f10e49', 'rel-66', 300);
		const r67 = rel('9f10e49', 'rel-67', 200);
		const r68 = rel('bf5be49', 'rel-68', 10);
		const rollouts = [
			rollout('fe', 'fe-dev', [r66, r67, r68], [{ r: r67, minutesAgo: 5 }]),
			rollout('fe', 'fe-prod', [r66, r67, r68], [{ r: r66, minutesAgo: 3 }])
		];
		const environments = [environment('fe', 'fe-dev', 'dev'), environment('fe', 'fe-prod', 'prod')];
		const [repo] = buildRevisionLedger(rollouts, environments);
		const same = repo.rows.filter((r) => r.revision === r66.revision);
		expect(same.length).toBe(2);
		expect(new Set(same.map((r) => r.key)).size).toBe(2);
		expect(same.every((r) => r.key.startsWith(r66.revision + '#'))).toBe(true);
		const lines = serviceLedger(repo).find((g) => g.appName === 'fe')!.lines;
		expect(lines.length).toBe(2);
		expect(new Set(lines.map((l) => `${l.appName}/${l.rowKey}`)).size).toBe(2);
	});
});
