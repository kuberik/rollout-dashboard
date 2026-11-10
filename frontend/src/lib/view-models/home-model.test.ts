import { describe, expect, it } from 'vitest';
import { buildHomeModel, type HomeModel } from './home-model';
import { homeInput } from './home/fixture';

/**
 * HOME ROUND 12 — THE ONE DATA MODEL, AGAINST THE STRESS FIXTURE
 * (`.work/home-r10/base/FIXTURE.md`). Same harness `home-r10-stress-fixture
 * .test.ts` uses (real `/api/rollouts` + `/api/github/changes` mock
 * responses, never the raw fixture arrays), so a regression here means
 * Home itself would see it too.
 *
 * These assertions are PINNED against the mock's actual output (cross-
 * checked ref by ref against `FIXTURE.md`'s own invoice-api table — stage,
 * env, and relative state all agree), not against the fixture doc's
 * now-stale placeholder sha spellings, which predate several PR-number
 * reassignments in `github-data.ts`. A ref moving to a different env/state
 * here is either a real fixture edit (update this table) or the round-12
 * regression this file exists to catch.
 */
/**
 * Ported from the home lab (design/home-r12-data 3d168544). The lab built
 * from its demo mock's `/api/rollouts` + `/api/github/changes`; main has no
 * demo, so every case runs on the pinned incident fixture (the same
 * scenario's raw inputs), `now` = its capture time. The lab's calm/wide
 * scenarios have no fixture and are dropped.
 */
function buildModel(scenario: 'incident' = 'incident') {
	void scenario;
	const input = homeInput();
	return { model: buildHomeModel(input), now: input.now };
}

type Placement = { env: string; ref: string; state: string };

function allPlacements(model: HomeModel, app: string): Placement[] {
	const a = model.apps.find((x) => x.app === app);
	if (!a) return [];
	const out: Placement[] = [];
	for (const m of a.merged) out.push({ env: 'merged', ref: m.ref, state: m.state });
	for (const env of a.envs) for (const c of env.myChanges) out.push({ env: env.env, ref: c.ref, state: c.state });
	return out;
}

function allMyChanges(model: HomeModel) {
	const out: { ref: string; repo: string; app: string; env: string; state: string }[] = [];
	for (const app of model.apps) {
		for (const c of app.merged) out.push({ ref: c.ref, repo: c.repo, app: app.app, env: 'merged', state: c.state });
		for (const env of app.envs)
			for (const c of env.myChanges) out.push({ ref: c.ref, repo: c.repo, app: app.app, env: env.env, state: c.state });
	}
	return out;
}

/** invoice-api's own 10 refs — FIXTURE.md's IA1..IA10 — at EXACTLY these
 *  (env, state) placements. Anything this table does not list must NOT
 *  appear (the "duplicates" bug: a ref showing up at a place it never
 *  reached, e.g. #43/#44 in `prod-us-east` before the round-12 fix). */
const INVOICE_API_EXPECTED: Placement[] = [
	{ env: 'dev', ref: '#44', state: 'deploying' }, // IA9, building
	{ env: 'dev', ref: '#43', state: 'healthy' }, // IA8, still the dev occupant
	// fix8 F1: test is promoted After dev (promotion-test), so it took IA8 at 18:32, when dev's bake
	// Succeeded, and baked it 10m; staging (After test) took IA8 at 18:43
	{ env: 'test', ref: '#43', state: 'healthy' }, // IA8, baked in test, test's current
	{ env: 'test', ref: '#42', state: 'superseded' }, // IA7, superseded by IA8
	{ env: 'staging', ref: '#43', state: 'healthy' }, // IA8, staging's current
	{ env: 'staging', ref: '#42', state: 'superseded' }, // IA7, superseded by IA8
	// IA6 (#41) is in the build staging runs and not yet in prod: unfinished, so fix 3's cap
	// (current occupant + one predecessor) does not hide it; it stays at its furthest reached env
	// (hc HC-1; fix8 F1 had let it drop out)
	{ env: 'staging', ref: '#41', state: 'superseded' },
	{ env: 'prod-eu-west', ref: '#37', state: 'failed' }, // IA2, unhealthy, stuck there
	{ env: 'prod-eu-west', ref: '#36', state: 'healthy' }, // IA1, live since its own deploy; the failed head (IA2) is #37's, so #36 is the last healthy occupant
	{ env: 'prod-us-east', ref: '#40', state: 'awaiting-approval' }, // IA5, the manual-approval gate's true frontier
	{ env: 'prod-us-east', ref: '#39', state: 'healthy' }, // IA4, current there
	{ env: 'prod-us-east', ref: '#38', state: 'rolled-back' }, // IA3, bake failed, rolled back
	{ env: 'prod-us-east', ref: '#37', state: 'superseded' }, // IA2, the rollback target, later superseded by IA4
	{ env: 'prod-us-west', ref: '#40', state: 'awaiting-approval' }, // IA5, fix7 B1: us-west needs approval too
	{ env: 'prod-us-west', ref: '#39', state: 'healthy' }, // IA4, current there
	{ env: 'prod-us-west', ref: '#38', state: 'superseded' }, // IA3 never ran here — IA2 is, but #38/IA3 reads superseded (contained-in IA4)
	{ env: 'merged', ref: 'a11ca10', state: 'not-deployed' } // IA10, just merged, nothing built yet
];

describe('home-model — stress fixture', () => {
	it('18 distinct viewer changes overall (one of them on two apps), 10 distinct refs on invoice-api', () => {
		// Authors follow the mock GitHub endpoint now (the viewer danielreed authors 17 changes of
		// the fixture): 18 distinct. Before: hc HC-1: 21 again. fix8 F1 had 20 after invoice-api's IA6 (#41) fell out of fix 3's
		// two-per-env cap; an unfinished change is never capped out (see INVOICE_API_EXPECTED)
		// ⭐ ROUND 12 DATA R3 — "21, not 20": `b17b002` is ONE PR affecting
		// TWO apps (`billing-api`/`billing-worker`, the repo-grouping
		// fixture), so it legitimately appears under both apps'
		// `myChanges` — summing per-app ref sets (the old formula) would
		// double-count it. Distinct-overall is now counted by (repo, ref),
		// which is the change's own real identity, not by app.
		const { model } = buildModel('incident');
		const mine = allMyChanges(model);
		const refsByApp = new Map<string, Set<string>>();
		for (const m of mine) (refsByApp.get(m.app) ?? refsByApp.set(m.app, new Set()).get(m.app)!).add(m.ref);
		const distinctOverall = new Set(mine.map((m) => `${m.repo}|${m.ref}`));
		expect(distinctOverall.size).toBe(18);
		expect(refsByApp.get('invoice-api')?.size).toBe(10);
	});

	it('REPO GROUPING: the billing PR carries both services in `apps`, and the same `repo`', () => {
		const { model } = buildModel('incident');
		const billingApi = model.apps.find((a) => a.app === 'billing-api')!;
		const billingWorker = model.apps.find((a) => a.app === 'billing-worker')!;
		expect(billingApi, 'billing-api should have a lane (it has its own ladder)').toBeTruthy();
		expect(billingWorker, 'billing-worker should appear even with no github ladder of its own — it has a viewer change').toBeTruthy();
		// Find the shared change on each app directly off the model — never
		// assume the ref string, which is hashed per-repo, not hand-picked.
		const onApi = [...billingApi.merged, ...billingApi.envs.flatMap((e) => e.myChanges)];
		const onWorker = [...billingWorker.merged, ...billingWorker.envs.flatMap((e) => e.myChanges)];
		const shared = onApi.find((c) => onWorker.some((w) => w.ref === c.ref && w.repo === c.repo));
		expect(shared, 'no change shared between billing-api and billing-worker').toBeTruthy();
		expect(shared!.repo).toBe('billing');
		expect(shared!.apps.slice().sort()).toEqual(['billing-api', 'billing-worker']);
		// Every OTHER change on these two apps names only its own app.
		for (const c of onApi) if (c.ref !== shared!.ref) expect(c.apps).toEqual(['billing-api']);
		for (const c of onWorker) if (c.ref !== shared!.ref) expect(c.apps).toEqual(['billing-worker']);
	});

	it('PIPELINE: invoice-api/dev is a multi-step canary in progress (step 2/4); invoice-api/test is fully stepped and baked', () => {
		const { model } = buildModel('incident');
		const invoiceApi = model.apps.find((a) => a.app === 'invoice-api')!;
		const dev = invoiceApi.envs.find((e) => e.env === 'dev')!;
		expect(dev.pipeline.isFallback).toBe(false);
		expect(dev.pipeline.tracks).toHaveLength(1);
		expect(dev.pipeline.tracks[0].stages.map((s) => s.state)).toEqual(['done', 'active', 'pending', 'pending']);
		expect(dev.pipeline.activeStep).toEqual({ index: 2, total: 4 });
		expect(dev.pipeline.bake).toBe('pending');

		const test = invoiceApi.envs.find((e) => e.env === 'test')!;
		expect(test.pipeline.isFallback).toBe(false);
		expect(test.pipeline.tracks[0].stages.every((s) => s.state === 'done')).toBe(true);
		expect(test.pipeline.activeStep).toBeNull();
		// fix8 F1: test's bake of a11c808 Succeeded at 18:42 (10m after dev's bake let it in)
		expect(test.pipeline.bake).toBe('done');
	});

	it('PIPELINE: an env with no linked KruiseRollouts falls back to the single deploy/bake track', () => {
		const { model } = buildModel('incident');
		const invoiceApi = model.apps.find((a) => a.app === 'invoice-api')!;
		const staging = invoiceApi.envs.find((e) => e.env === 'staging')!;
		expect(staging.pipeline.isFallback).toBe(true);
		expect(staging.pipeline.tracks).toHaveLength(1);
		expect(staging.pipeline.tracks[0].name).toBeNull();
	});

	it('invoice-api: every placement is EXACTLY the pinned (env, ref, state) table — no more, no fewer', () => {
		const { model } = buildModel('incident');
		const actual = allPlacements(model, 'invoice-api');
		const norm = (p: Placement[]) => [...p].sort((a, b) => (a.env + a.ref).localeCompare(b.env + b.ref));
		expect(norm(actual)).toEqual(norm(INVOICE_API_EXPECTED));
	});

	it('no env holds more than ONE held-like (awaiting-approval/held-by-rule) entry — the duplicate-gate bug', () => {
		// The round-12 bug: `pr-pipeline.ts` computes `held`/`gated` off the
		// ENV's own rollout, identically for every queued row behind the real
		// frontier, so #43/#44 (not yet even offered to prod-us-east) used to
		// read `awaiting-approval` there alongside the true frontier, #40.
		for (const scenario of ['incident'] as const) {
			const { model } = buildModel(scenario);
			for (const app of model.apps) {
				for (const env of app.envs) {
					const held = env.myChanges.filter((c) => c.state === 'awaiting-approval' || c.state === 'held-by-rule');
					expect(held.length, `${app.app}/${env.env}`).toBeLessThanOrEqual(1);
				}
			}
		}
	});

	it('no env lists more than 2 of the viewer\'s LIVE-occupancy (non-failed/rolled-back/held) changes', () => {
		// Fix 3's own running cap: current occupant + at most one dim
		// predecessor. A regression here is the "ancestor repeated as live
		// in every env" bug coming back. Held-like entries are a SEPARATE,
		// single-slot concept (previous test) and are excluded here.
		// hc HC-1: an unfinished change the cap left nowhere at or past its furthest reached env
		// is placed there on top of the two (invoice-api staging: #43, #42, then #41), so the
		// bound counts only the entries of changes that are live in every env they are headed to.
		const { model } = buildModel('incident');
		const nonCapped = new Set(['failed', 'rolled-back', 'awaiting-approval', 'held-by-rule']);
		const unfinished = new Set(['#41']);
		for (const app of model.apps) {
			for (const env of app.envs) {
				const ordinary = env.myChanges.filter((c) => !nonCapped.has(c.state));
				const capped = ordinary.filter((c) => !(app.app === 'invoice-api' && unfinished.has(c.ref)));
				expect(capped.length, `${app.app}/${env.env}`).toBeLessThanOrEqual(2);
			}
		}
	});

	it('IA2 (#37) reads failed ONLY at prod-eu-west, never at prod-us-east/us-west', () => {
		const { model } = buildModel('incident');
		const invoiceApi = model.apps.find((a) => a.app === 'invoice-api')!;
		expect(invoiceApi).toBeTruthy();
		const failedRegions = invoiceApi.envs.filter((e) => e.myChanges.some((c) => c.state === 'failed')).map((e) => e.env);
		expect(failedRegions).toEqual(['prod-eu-west']);
	});

	it('the IA3 (#38) rolled-back mark is named at its exact prod region only', () => {
		const { model } = buildModel('incident');
		const invoiceApi = model.apps.find((a) => a.app === 'invoice-api')!;
		const rolledBackRegions = invoiceApi.envs.filter((e) => e.myChanges.some((c) => c.state === 'rolled-back'));
		expect(rolledBackRegions.length).toBe(1);
		expect(rolledBackRegions[0].env).toBe('prod-us-east');
	});

	it('the invoice-api manual-approval gate reads awaiting-approval, never held-by-rule', () => {
		const { model } = buildModel('incident');
		const invoiceApi = model.apps.find((a) => a.app === 'invoice-api')!;
		const approvalHits = invoiceApi.envs.flatMap((e) => e.myChanges.filter((c) => c.state === 'awaiting-approval'));
		// us-east and (fix7 B1) us-west both carry the manual-approval gate; #40 is the frontier in each
		expect(approvalHits.map((c) => c.ref)).toEqual(['#40', '#40']);
	});

	it('STATE AGREEMENT: an env\'s own state agrees with the worst viewer-change state placed there', () => {
		const { model } = buildModel('incident');
		const WORST_ORDER = ['failed', 'rolled-back', 'awaiting-approval', 'held-by-rule', 'checking', 'deploying', 'superseded', 'healthy', 'not-deployed'];
		for (const app of model.apps) {
			for (const env of app.envs) {
				if (env.myChanges.length === 0) continue;
				const worst = [...env.myChanges].sort((a, b) => WORST_ORDER.indexOf(a.state) - WORST_ORDER.indexOf(b.state))[0];
				// A failed/held change at this env means the ENV's own state
				// must read the same way — the exact "prod-eu-west healthy
				// while #37 there is failed" / "prod-us-east held-by-rule
				// instead of awaiting-approval" bugs.
				if (worst.state === 'failed') expect(env.state, `${app.app}/${env.env}`).toBe('failed');
				if (worst.state === 'awaiting-approval') expect(env.state, `${app.app}/${env.env}`).toBe('awaiting-approval');
			}
		}
		// Named cases from the coordinator's own inspection.
		const invoiceApi = model.apps.find((a) => a.app === 'invoice-api')!;
		const euWest = invoiceApi.envs.find((e) => e.env === 'prod-eu-west')!;
		expect(euWest.state).toBe('failed');
		const usEast = invoiceApi.envs.find((e) => e.env === 'prod-us-east')!;
		expect(usEast.state).toBe('awaiting-approval');
	});

	it('SIGNALS: the expected signal set is present (no stall/idle signal ever)', () => {
		const { model } = buildModel('incident');
		expect(model.signals.every((s) => (s.kind as string) !== 'stall')).toBe(true);
		const byApp = new Map(model.signals.map((s) => [`${s.app}|${s.env}`, s] as const));
		expect(['failed', 'check-failing']).toContain(byApp.get('checkout-worker|staging')?.kind);
		expect(byApp.get('invoice-api|prod-eu-west')?.kind).toBe('check-failing');
		// edge-mesh dev is 41m into its 60m spec.bakeTime: on schedule, not a slow bake (fix7 A1)
		expect(model.signals.some((s) => s.app === 'edge-mesh' && s.kind === 'slow-bake')).toBe(false);
	});

	it('NEEDS-YOU: real verb phrases, never an unattributed "a rule"/"a check" noun, one row per (app, cause)', () => {
		const { model } = buildModel('incident');
		for (const entry of model.fleet.needsYou) {
			expect(entry.phrase).not.toMatch(/dashboard cannot attribute/);
			expect(entry.phrase).not.toBe('a check');
			expect(entry.phrase).not.toBe('held');
		}
		// invoice-api carries TWO distinct problems, in two different places —
		// folding to one row per app (instead of one per app+cause) would have
		// hidden the approval hold behind the louder failure.
		const invoiceApiEntries = model.fleet.needsYou.filter((n) => n.app === 'invoice-api');
		expect(invoiceApiEntries).toHaveLength(2);
		expect(invoiceApiEntries.find((n) => n.env === 'prod-eu-west')?.phrase).toBe('failed its health check');
		expect(invoiceApiEntries.find((n) => n.env === 'prod-us-east')?.phrase).toBe('waits for approval');
		// checkout-api was held across 4 prod regions on the SAME cause in the
		// coordinator's inspection — exactly one row survives. Its other row is a
		// different cause: af-south-1 is pinned to its rollback (fix7 B2).
		expect(
			model.fleet.needsYou.filter((n) => n.app === 'checkout-api').map((n) => [n.env, n.cause])
		).toEqual([
			['staging', 'dependency'],
			['prod-af-south-1', 'other']
		]);
		expect(model.fleet.needsYou.find((n) => n.app === 'telemetry-indexer')?.phrase).toBe('waits for approval');
	});

	it('LEAD: invoice-api gets a figure, a failing phrase, and both actions', () => {
		const { model } = buildModel('incident');
		const invoiceApi = model.apps.find((a) => a.app === 'invoice-api')!;
		expect(invoiceApi.figure).toMatch(/^\d+[a-z]+$/);
		expect(invoiceApi.phrase).toBe('failing in prod-eu-west');
		expect(invoiceApi.primaryAction).toEqual({ label: 'Roll back prod-eu-west', href: expect.stringContaining('prod-eu-west') });
		expect(invoiceApi.secondaryAction).toEqual({ label: 'Review approval in prod-us-east', href: expect.stringContaining('prod-us-east') });
	});

	it('every timestamp in the model is at or before "now"', () => {
		const { model, now } = buildModel('incident');
		const nowMs = now.getTime();
		const bad: string[] = [];
		const check = (iso: string | null, label: string) => {
			if (!iso) return;
			const t = Date.parse(iso);
			if (Number.isFinite(t) && t > nowMs) bad.push(`${label}: ${iso}`);
		};
		for (const app of model.apps) {
			for (const c of app.merged) {
				check(c.mergedAt, `${app.app} merged ${c.ref}`);
				check(c.since, `${app.app} merged-since ${c.ref}`);
			}
			for (const env of app.envs) {
				check(env.arrivedAt, `${app.app}/${env.env} arrivedAt`);
				for (const c of env.myChanges) {
					check(c.mergedAt, `${app.app}/${env.env} ${c.ref} mergedAt`);
					check(c.since, `${app.app}/${env.env} ${c.ref} since`);
				}
			}
		}
		for (const s of model.signals) check(s.since, `signal ${s.key}`);
		expect(bad).toEqual([]);
	});

	it('a just-merged viewer change with no build anywhere appears under "merged", not lost', () => {
		const { model } = buildModel('incident');
		const invoiceApi = model.apps.find((a) => a.app === 'invoice-api')!;
		expect(invoiceApi.merged.map((m) => m.ref)).toContain('a11ca10');
	});

	it('fleet totals and prod-healthy counts agree with Home\'s own "not failed/stuck" arithmetic', () => {
		const { model } = buildModel('incident');
		expect(model.fleet.prodHealthy.healthy).toBeLessThanOrEqual(model.fleet.prodHealthy.total);
		expect(model.fleet.apps).toBeGreaterThan(0);
		// A prod region genuinely failing (invoice-api/prod-eu-west) must count
		// against prodHealthy — the "25/35 vs the pages' 35/35" bug was two
		// faults stacked: the WRONG arithmetic (counting held/deploying/
		// checking as unhealthy) hid a REAL failure this fixture needs counted.
		expect(model.fleet.prodHealthy.healthy).toBeLessThan(model.fleet.prodHealthy.total);
	});
});
