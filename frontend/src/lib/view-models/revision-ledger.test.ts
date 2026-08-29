import { describe, it, expect } from 'vitest';
import {
	buildRevisionLedger,
	groupServicesByLabel,
	rankSentence,
	resolveRevision,
	rowNamesBuild
} from './revision-ledger';
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
			of: 'of 3'
		});
		expect(rankSentence(head.services.find((s) => s.appName === 'web')!)).toEqual({
			rank: 'newest',
			of: 'of 3'
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
