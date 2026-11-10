import { describe, expect, it } from 'vitest';
import raw from './fixtures/incident-input.json';
import { buildTopology, deployNameOf, placeKeyOf, upstreamOf } from '../sites-waves';
import type { Environment } from '../../../types';

/**
 * The incident fixture's history timing, held to what the controllers allow (fix8, QA v2-5 F1).
 *
 * environment-controller lists a build in an `After X` environment's promotion gate only once X's
 * history entry for it is Succeeded; the rollout-controller then deploys it on its next reconcile.
 * So a System deploy behind an upstream site (sites-waves `upstreamOf`: the tier before, or the wave before)
 * lands within minutes of the upstream bake's end.
 */
type H = {
	version: { tag: string; revision?: string };
	timestamp: string;
	bakeStatus?: string;
	bakeStartTime?: string;
	bakeEndTime?: string;
	triggeredBy?: { kind?: string };
};
type R = {
	metadata: { name: string; namespace: string };
	spec: { bakeTime?: string };
	status: {
		history?: H[];
		gates?: { name: string; allowedVersions?: string[] | null; message?: string }[];
	};
};
type E = {
	metadata: { name: string; namespace: string };
	spec: { name: string; environment: string; site?: string; wave?: number };
	status?: {
		rolloutGateRef?: { name: string };
		currentVersion?: string;
		wave?: { members?: { environment: string; site: string }[] };
	};
};
const f = raw as unknown as { rollouts: R[]; environments: E[]; capturedAt: string };
const ro = (ns: string, name: string) =>
	f.rollouts.find((r) => r.metadata.namespace === ns && r.metadata.name === name)!;
/** An Environment by app and PLACE (`dev`, or `prod-<site>` while the tier has several sites). */
const env = (app: string, e: string) =>
	f.environments.find(
		(x) => x.spec.name === app && placeKeyOf(x as unknown as Environment, f.environments as unknown as Environment[]) === e
	)!;
const MIN = 60e3;

describe('incident fixture: invoice-api promotion timing (fix8 F1)', () => {
	it('test is promoted after dev (its wave status lists dev as the tier before), through the promotion-test gate', () => {
		expect(env('invoice-api', 'test').spec).not.toHaveProperty('relationship');
		expect(env('invoice-api', 'test').status?.wave?.members?.map((m) => m.environment)).toEqual([
			'dev',
			'test'
		]);
		expect(env('invoice-api', 'test').status?.rolloutGateRef).toEqual({ name: 'promotion-test' });
		expect(ro('invoice-api-test', 'invoice-api').status.gates?.map((g) => g.name)).toEqual([
			'promotion-test'
		]);
	});

	it('test took a11c808 within minutes of dev baking it, and staging within minutes of test', () => {
		const devEntry = ro('invoice-api-dev', 'invoice-api').status.history!.find(
			(h) => h.version.tag === 'a11c808' && h.bakeStatus === 'Succeeded'
		)!;
		const test = ro('invoice-api-test', 'invoice-api').status.history![0];
		const staging = ro('invoice-api-staging', 'invoice-api').status.history![0];
		expect([test.version.tag, test.bakeStatus, staging.version.tag, staging.bakeStatus]).toEqual([
			'a11c808',
			'Succeeded',
			'a11c808',
			'Succeeded'
		]);
		const lag = (a: string, b: string) => Date.parse(b) - Date.parse(a);
		expect(lag(devEntry.bakeEndTime!, test.timestamp)).toBeGreaterThanOrEqual(0);
		expect(lag(devEntry.bakeEndTime!, test.timestamp)).toBeLessThanOrEqual(5 * MIN);
		// test's spec.bakeTime is 10m: handleBakeTime ends the bake exactly then
		expect(lag(test.bakeStartTime!, test.bakeEndTime!)).toBe(10 * MIN);
		expect(lag(test.bakeEndTime!, staging.timestamp)).toBeGreaterThanOrEqual(0);
		expect(lag(test.bakeEndTime!, staging.timestamp)).toBeLessThanOrEqual(5 * MIN);
	});

	it('neither gate lists a build: dev is still deploying a11c909, so test and staging are at rest', () => {
		for (const ns of ['invoice-api-test', 'invoice-api-staging'])
			expect(ro(ns, 'invoice-api').status.gates?.[0]).toMatchObject({
				allowedVersions: [],
				message: 'Gate does not allow any release candidate'
			});
		expect(ro('invoice-api-dev', 'invoice-api').status.history![0]).toMatchObject({
			version: { tag: 'a11c909' },
			bakeStatus: 'Deploying'
		});
	});
});

/**
 * QA v2-5's history-timing rule (fix8): a System deploy comes no later than the controllers allow it,
 * 5m slack, over the last 24h: the entry under it finished, the release was available (the tag's first
 * deploy anywhere in the app), and with `After X` X's entry for it Succeeded. Rollouts with a gate a
 * controller does not time (approval, dependency, check, schedule) are skipped.
 *
 * The places below are late and stay so on purpose: re-timing each as the controller would leaves
 * Home's view identical (fix8-v2/v8 variants; consistency.cjs prints them as INFO). Any other late
 * deploy is a FAIL: it changes Home, or nobody has shown it does not.
 */
const LATE_NOT_ON_HOME = [
	/^(orders-api-dev|checkout-worker-dev|recommender-svc-dev)$/,
	/^checkout-edge-staging$/,
	/^payments-core-staging$/,
	/^edge-mesh-prod-/,
	/^invoice-api-staging$/
];
type FR = R & {
	metadata: { name: string; namespace: string };
	status: R['status'] & {
		availableReleases?: { tag: string; created?: string }[];
		releaseCandidates?: { tag: string; created?: string }[];
	};
};
const ROLLOUTS = f.rollouts as FR[];
type EnvRef = E & { spec: E['spec'] & { rolloutRef?: { name: string } } };
const TOPOS = buildTopology(f.environments as unknown as Environment[]);
const PROMOTED = new Set(['invoice-api', 'hello-dep-frontend-app', 'checkout-api-service', 'hello-world-app']);

function lateDeploys(): string[] {
	const T = Date.parse(f.capturedAt);
	const out: string[] = [];
	for (const r of ROLLOUTS) {
		const app = r.metadata.name;
		if ((r.status.gates ?? []).some((g) => !g.name.startsWith('promotion-'))) continue;
		const e = (f.environments as EnvRef[]).find(
			(x) => x.metadata.namespace === r.metadata.namespace && x.spec.rolloutRef?.name === app
		);
		// Apps whose environments are promoted through each other (they carried an `After` edge before
		// sites and waves); every other app's late deploys are judged without an upstream.
		const topo = e ? TOPOS.get(deployNameOf(e as unknown as Environment)) : undefined;
		const node = topo?.tiers.flatMap((t) => t.sites).find((x) => (x.env as unknown) === e);
		const upNode = PROMOTED.has(e?.spec.name ?? '') && topo && node ? upstreamOf(topo, node).find((x) => x.env) : undefined;
		const upEnv = upNode?.env as unknown as EnvRef | undefined;
		const up =
			upEnv &&
			ROLLOUTS.find(
				(x) =>
					x.metadata.namespace === upEnv.metadata.namespace &&
					x.metadata.name === upEnv.spec.rolloutRef?.name
			);
		const hs = r.status.history ?? [];
		for (let i = 0; i < hs.length - 1; i++) {
			const h = hs[i];
			if (h.triggeredBy?.kind === 'User') continue;
			const ts = Date.parse(h.timestamp);
			if (T - ts > 24 * 3600e3) continue;
			const prevEnd = Date.parse(hs[i + 1].bakeEndTime ?? hs[i + 1].timestamp);
			const disc = Math.min(
				...ROLLOUTS.filter((x) => x.metadata.name === app).flatMap((x) =>
					(x.status.history ?? [])
						.filter((y) => y.version.tag === h.version.tag)
						.map((y) => Date.parse(y.timestamp))
				)
			);
			let upEnd = 0;
			if (up) {
				const u = (up.status.history ?? [])
					.filter((x) => x.version.tag === h.version.tag && x.bakeStatus === 'Succeeded')
					.map((x) => Date.parse(x.bakeEndTime ?? x.timestamp));
				upEnd = u.length ? Math.min(...u) : Infinity;
			}
			if (ts - Math.max(prevEnd, disc, upEnd) > 5 * MIN)
				out.push(`${r.metadata.namespace} [${i}] ${h.version.tag}`);
		}
	}
	return out;
}

describe('incident fixture: no System deploy later than the controllers allow (fix8)', () => {
	it('every late deploy is one whose re-timing leaves Home unchanged', () => {
		const late = lateDeploys();
		expect(late.filter((x) => !LATE_NOT_ON_HOME.some((re) => re.test(x.split(' ')[0])))).toEqual(
			[]
		);
		// and the known ones are still there: the list is evidence, not a wildcard
		expect(late.length).toBe(18);
	});

	it("a release's created is its image's: one value per app+tag, never after the tag's first deploy (LOW d)", () => {
		const created = new Map<string, Set<string>>();
		const first = new Map<string, string>();
		for (const r of ROLLOUTS) {
			const app = r.metadata.name;
			for (const v of [
				...(r.status.availableReleases ?? []),
				...(r.status.releaseCandidates ?? []),
				...(r.status.history ?? []).map((h) => h.version as { tag: string; created?: string })
			])
				if (v.created)
					(
						created.get(`${app}|${v.tag}`) ??
						created.set(`${app}|${v.tag}`, new Set()).get(`${app}|${v.tag}`)!
					).add(v.created);
			for (const h of r.status.history ?? []) {
				const k = `${app}|${h.version.tag}`;
				if (!first.has(k) || h.timestamp < first.get(k)!) first.set(k, h.timestamp);
			}
		}
		const bad = [...created]
			.filter(([k, s]) => s.size !== 1 || (first.has(k) && [...s][0] > first.get(k)!))
			.map(([k]) => k);
		expect(bad).toEqual([]);
		expect([...created.get('billing-api|b17b003')!]).toEqual(['2026-10-24T19:34:26.893Z']);
	});
});
