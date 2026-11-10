import { describe, expect, it } from 'vitest';
import { buildHomeModel, buildLumenHome, watchSub, type HomeModel, type LumenHome } from './index';
import { homeInput } from './fixture';

/**
 * buildLumenHome on the pinned incident fixture (`fixtures/incident-input.json`,
 * `now` = its `capturedAt`), against the r21 content decisions
 * (`.work/home-r21/BRIEF.md`) and the r18 content contract.
 *
 * The lab's two-app STARRED pair is passed explicitly where a case needs
 * stars; the product default is nothing starred.
 */
const LAB_STARRED = new Set(['hello-frontend-app', 'checkout-api']);

function build(starredApps: ReadonlySet<string> = LAB_STARRED): {
	model: HomeModel;
	home: LumenHome;
} {
	const input = homeInput();
	const model = buildHomeModel({ ...input, starredApps });
	return { model, home: buildLumenHome(model, input.now, { starredApps }) };
}

/**
 * The fixture with edge-mesh dev's bake started 75m before capture: past its
 * 60m spec.bakeTime by more than the margin, so a slow bake (fix7 A1). The
 * fixture's own bake is 41m in, on schedule.
 */
function buildSlowBake(starredApps: ReadonlySet<string> = LAB_STARRED) {
	const input = homeInput();
	input.rollouts = structuredClone(input.rollouts);
	const r = input.rollouts.find(
		(x) => x.metadata?.namespace === 'edge-mesh-dev' && x.metadata?.name === 'edge-mesh'
	)!;
	const h = r.status!.history![0];
	h.bakeStartTime = h.timestamp = new Date(input.now.getTime() - 75 * 60e3).toISOString();
	const model = buildHomeModel({ ...input, starredApps });
	return { model, home: buildLumenHome(model, input.now, { starredApps }) };
}

const flight = (h: LumenHome, ref: string) => h.allFlights.find((f) => f.ref === ref);
const yoursApps = (h: LumenHome) => [...h.busy, ...h.allLive].map((g) => g.app);
const line = (f: { word: string; ageLabel: string; next: string }) =>
	[f.word, f.ageLabel, f.next].filter(Boolean).join(' · ');

describe('sections (a)', () => {
	it('places every app in exactly one of Your changes, Watch, Rolling out, Quiet', () => {
		const { model, home } = build();
		const sections = [
			yoursApps(home),
			[...new Set(home.watch.map((w) => w.app))],
			[...new Set(home.rolling.map((r) => r.app))],
			home.quiet.map((q) => q.app)
		];
		for (const a of model.apps) {
			const hits = sections.filter((s) => s.includes(a.app)).length;
			expect(hits, a.app).toBe(1);
		}
		expect(sections.flat().length).toBe(model.apps.length);
	});

	it('Needs you only repeats apps that are also in Your changes', () => {
		const { home } = build();
		for (const n of home.needs) expect(yoursApps(home)).toContain(n.app);
	});

	it('pins the fixture sections', () => {
		const { home } = build();
		expect(home.busy.map((g) => g.app)).toEqual([
			'invoice-api',
			'checkout-worker',
			'recommender-svc',
			'telemetry-indexer',
			// moving (#80 in bake); the held-by-payments-svc places are someone else's #81 now
			'checkout-api',
			'telemetry-worker'
		]);
		expect(home.allLive.map((g) => g.app).sort()).toEqual([
			'billing-api',
			'billing-worker',
			'hello-frontend-app',
			'hello-world',
			'orders-api',
			'telemetry-collector',
			'telemetry-forwarder'
		]);
		// checkout-api carries a change of yours (#80); hello-frontend-app and orders-api
		// carry none in flight now (their #13 and #90 belong to anna-ward and paul-stevens),
		// so their failure and hold are lines under their live rows
		// edge-mesh dev's bake is 41m into its 60m spec.bakeTime: on schedule, so not a
		// slow-bake Watch line (fix7 A1); it is an app rolling out, in bake.
		// The early signals: standalone-api prod, held by its RolloutDependency on
		// ledger-core (see 'the early signal' below), and telemetry-collector prod's
		// error-rate check flapping (hc-v2, see 'the flapping check' below)
		// telemetry-collector's flapping check is a line under its row now: the viewer's #20 runs there
		expect(home.watch.map((w) => `${w.app} ${w.place} ${w.kind}`)).toEqual([
			'standalone-api prod held'
		]);
		expect(home.rolling.map((r) => `${r.app} ${r.place} ${r.step}`)).toEqual([
			'checkout-edge dev deploying',
			'checkout-edge prod in bake',
			'edge-mesh dev in bake',
			'payments-core test in bake'
		]);
		// every app with a change of yours is in Your changes; none is left to be quiet
		expect(home.quiet.map((q) => q.app)).toEqual([]);
		expect(home.lead?.app).toBe('invoice-api');
		// decision 3: apps holding a stuck change lead the rest; stub-only apps (all in Needs you) last
		expect(home.rest.map((g) => g.app)).toEqual([
			'recommender-svc',
			'telemetry-indexer',
			'checkout-api',
			'telemetry-worker',
			'checkout-worker'
		]);
	});
});

describe('next-step phrases (b)', () => {
	it('deploying: the pipeline step, then what follows', () => {
		const f = flight(build().home, '#44')!;
		expect([f.where, f.word, f.next]).toEqual([
			'dev',
			'deploying',
			'step 2 of 4 · next: bake, then test'
		]);
	});

	// fix8 F1: invoice-api test no longer bakes #43 (it took a11c808 at 18:32, when dev's bake let it
	// in, and finished at 18:42); checkout-api #80 in prod us-east-2 is the fixture's own-change bake
	it('bake: minutes left from the rollout spec.bakeTime (#80 in prod us-east-2, ~5m left)', () => {
		const f = flight(build().home, '#80')!;
		expect([f.where, f.word, f.next]).toEqual([
			'prod us-east-2',
			'in bake',
			'next: live after bake · ~5m'
		]);
	});

	it('bake: no minutes when the data has none (no invented ETA)', () => {
		const { model } = build();
		const m = structuredClone(model);
		const env = m.apps
			.find((a) => a.app === 'checkout-api')!
			.envs.find((e) => e.env === 'prod-us-east-2')!;
		env.myChanges.find((c) => c.ref === '#80')!.checkingMinutesLeft = null;
		const f = buildLumenHome(m, new Date(homeInput().now)).allFlights.find((x) => x.ref === '#80')!;
		expect(f.next).toBe('next: live after bake');
	});

	it('bake: minutes left come from the data only', () => {
		const { model } = build();
		const m = structuredClone(model);
		const env = m.apps
			.find((a) => a.app === 'checkout-api')!
			.envs.find((e) => e.env === 'prod-us-east-2')!;
		env.myChanges.find((c) => c.ref === '#80')!.checkingMinutesLeft = 7;
		const f = buildLumenHome(m, new Date(homeInput().now)).allFlights.find((x) => x.ref === '#80')!;
		expect(f.next).toBe('next: live after bake · ~7m');
	});

	it('own change waiting for approval: waits for a reviewer, quiet Open link', () => {
		const f = flight(build().home, '#40')!;
		expect([f.where, f.word, f.age, f.next]).toEqual([
			// fix7 B1: us-west carries the same manual-approval gate
			'prod us-east, us-west',
			'waits for a reviewer',
			// its own wait: b-40 reached staging at 15:11, not the 18:01 arrival of the build running in us-east
			'4h',
			'next: deploys to us-east, us-west once approved'
		]);
		expect(f.link?.label).toBe('Open approval');
	});

	it('an approval waiting in several prod regions is one row naming every region', () => {
		// us-west carries the same manual-approval gate as us-east, so #40 (a11c505)
		// waits for a reviewer in both. The fixture has it since fix7 B1; the variant sets
		// it here too so this case does not depend on the fixture's story.
		const input = homeInput();
		input.rollouts = structuredClone(input.rollouts);
		const west = input.rollouts.find(
			(r) =>
				r.metadata?.namespace === 'invoice-api-prod-us-west' && r.metadata?.name === 'invoice-api'
		)!;
		west.status!.gates = [
			{
				name: 'invoice-api-manual-approval',
				allowedVersions: ['a11c404'],
				message: 'Gate does not allow any release candidate'
			}
		] as never;
		const model = buildHomeModel({ ...input, starredApps: LAB_STARRED });
		const home = buildLumenHome(model, input.now, { starredApps: LAB_STARRED });
		const rows = home.allFlights.filter((f) => f.ref === '#40');
		expect(rows).toHaveLength(1);
		expect([rows[0].where, rows[0].word, rows[0].next, rows[0].link?.href]).toEqual([
			'prod us-east, us-west',
			'waits for a reviewer',
			'next: deploys to us-east, us-west once approved',
			'/rollouts/prod/invoice-api-prod-us-east/invoice-api'
		]);
	});

	it('held over an hour: stuck · held Nh · waits on <the check>', () => {
		const h = build().home;
		// #90 on orders-api is paul-stevens's now; the viewer's one held change is #28
		expect(flight(h, '#90')).toBeUndefined();
		expect(line(flight(h, '#28')!)).toBe('stuck · held 6h · waits on offline-eval');
	});

	it('a check hold with no check name in the data keeps "waits on a check"', () => {
		const { model } = build();
		const m = structuredClone(model);
		for (const n of m.fleet.needsYou) delete n.facts.checks;
		const h = buildLumenHome(m, new Date(homeInput().now));
		expect(line(flight(h, '#28')!)).toBe('stuck · held 6h · waits on a check');
	});

	it('the check name drops the app prefix, and a held Watch line names it too', () => {
		const { model } = build();
		const m = structuredClone(model);
		const ny = m.fleet.needsYou.find((n) => n.app === 'recommender-svc' && n.facts.reason === 'check')!;
		ny.facts.checks = ['recommender-svc-offline-eval', 'smoke'];
		const h = buildLumenHome(m, new Date(homeInput().now));
		expect(line(flight(h, '#28')!)).toBe('stuck · held 6h · waits on offline-eval, smoke');
		expect(
			watchSub({
				key: 'k',
				kind: 'held',
				app: 'recommender-svc',
				appHref: '/apps/recommender-svc',
				place: 'prod',
				places: ['prod'],
				evidence: '',
				facts: { kind: 'held', reason: 'check', checks: ['recommender-svc-offline-eval'] },
				age: '',
				ageMs: 0,
				href: '/',
				sev: 3
			})
		).toBe(' · on offline-eval');
	});

	it('held under an hour reads held, not stuck', () => {
		const { model } = build();
		const m = structuredClone(model);
		const now = new Date(homeInput().now);
		const c = m.apps
			.find((a) => a.app === 'recommender-svc')!
			.envs.find((e) => e.env === 'prod')!
			.myChanges.find((x) => x.ref === '#28')!;
		c.since = new Date(now.getTime() - 20 * 60_000).toISOString();
		const f = buildLumenHome(m, now).allFlights.find((x) => x.ref === '#28')!;
		expect([f.word, f.stuck, f.ageLabel]).toEqual(['held', false, '20m']);
	});

	it("a held change the model cannot date has no age: never the app's figure", () => {
		const { model } = build();
		const m = structuredClone(model);
		const app = m.apps.find((a) => a.app === 'recommender-svc')!;
		app.envs.find((e) => e.env === 'prod')!.myChanges.find((x) => x.ref === '#28')!.since = null;
		expect(app.figure).toBe('6h');
		const f = buildLumenHome(m, new Date(homeInput().now)).allFlights.find((x) => x.ref === '#28')!;
		expect([f.word, f.stuck, f.age]).toEqual(['held', false, '']);
		expect(line(f)).toBe('held · waits on offline-eval');
	});

	it('failed: stopped, failed its health check', () => {
		const h = build().home;
		// fix8: eu-west has no gate, so the controller took a11c202 at 10:32, not 11:25: 9h
		expect(line(flight(h, '#37')!)).toBe('failing · 9h · stopped: failed its health check');
		expect(line(flight(h, '#14')!)).toBe('failing · 2m · stopped: failed its health check');
	});

	it('rolled back, carried back in by the running build: back in, never gone (#38 in #39)', () => {
		const { model, home } = build();
		const env = model.apps
			.find((a) => a.app === 'invoice-api')!
			.envs.find((e) => e.env === 'prod-us-east')!;
		expect(env.myChanges.find((c) => c.ref === '#38')).toMatchObject({
			state: 'rolled-back',
			liveAgain: true
		});
		const f = flight(home, '#38')!;
		expect([f.where, f.word, f.next]).toEqual([
			'prod us-east',
			'rolled back',
			'back in us-east with #39'
		]);
		// counts unchanged: still one of the changes in progress
		expect(home.totals.text).toBe('17 changes · 11 in progress · 6 live');
	});

	it('rolled back and not in the running build: what runs there now', () => {
		const { model } = build();
		const m = structuredClone(model);
		const env = m.apps
			.find((a) => a.app === 'invoice-api')!
			.envs.find((e) => e.env === 'prod-us-east')!;
		delete env.myChanges.find((c) => c.ref === '#38')!.liveAgain;
		const f = flight(buildLumenHome(m, new Date(homeInput().now)), '#38')!;
		expect([f.where, f.word, f.next]).toEqual([
			'prod us-east',
			'rolled back',
			'us-east now runs #39'
		]);
	});

	it('passed: the next env, and what its gate says', () => {
		const h = build().home;
		// fix8 F1: test is promoted After dev, so it baked #43 by 18:42 and staging (After test)
		// took it at 18:43: #43, #42 and #41 (hc HC-1: unfinished, so never capped out) all
		// passed staging. fix8 (a): every prod region needs a person's approval, build by build;
		// none of them queues behind #40's approval
		for (const ref of ['#43', '#42', '#41']) {
			expect([flight(h, ref)!.where, flight(h, ref)!.word, flight(h, ref)!.ageLabel], ref).toEqual([
				'staging',
				'passed',
				'58m'
			]);
			expect(flight(h, ref)!.next, ref).toBe('next: prod, needs approval');
		}
	});

	describe("fix8 F2: next is the NEXT place's gate facts, in every state", () => {
		const invoice = (m: ReturnType<typeof build>['model']) =>
			m.apps.find((a) => a.app === 'invoice-api')!;
		const at = (m: ReturnType<typeof build>['model'], env: string) =>
			invoice(m).envs.find((e) => e.env === env)!;
		const rebuild = (m: ReturnType<typeof build>['model']) =>
			buildLumenHome(m, new Date(homeInput().now));

		it('deploying #44 in dev: test has no gate holding it, so test takes it once dev bakes it', () => {
			expect(flight(build().home, '#44')!.next).toBe('step 2 of 4 · next: bake, then test');
		});

		it('deploying #44: an approval or a hold at test is named; one two envs ahead is not', () => {
			const { model } = build();
			const a = structuredClone(model);
			at(a, 'test').state = 'awaiting-approval';
			expect(flight(rebuild(a), '#44')!.next).toBe(
				'step 2 of 4 · next: bake, then test, needs approval'
			);
			const b = structuredClone(model);
			at(b, 'test').state = 'held-by-rule';
			expect(flight(rebuild(b), '#44')!.next).toBe(
				'step 2 of 4 · next: bake, then test · test is held'
			);
			const c = structuredClone(model);
			at(c, 'staging').state = 'held-by-rule';
			expect(flight(rebuild(c), '#44')!.next).toBe('step 2 of 4 · next: bake, then test');
		});

		it('passed #43 in staging: with no gate holding prod, prod takes it', () => {
			const { model } = build();
			const m = structuredClone(model);
			for (const e of invoice(m).envs) if (e.isProdRegion) e.state = 'healthy';
			expect(flight(rebuild(m), '#43')!.next).toBe('next: prod');
		});

		it("checking: the next env after this bake, with that env's gate", () => {
			const { model } = build();
			const m = structuredClone(model);
			const test = at(m, 'test');
			const c43 = test.myChanges.find((c) => c.ref === '#43')!;
			Object.assign(c43, { state: 'checking', checkingMinutesLeft: 7 });
			test.state = 'checking';
			test.pipeline.bake = 'active';
			// #43 also sits in staging; take it out there so test is its frontier
			at(m, 'staging').myChanges = at(m, 'staging').myChanges.filter((c) => c.ref !== '#43');
			expect(flight(rebuild(m), '#43')!.next).toBe('next: staging after bake · ~7m');
			at(m, 'staging').state = 'held-by-rule';
			expect(flight(rebuild(m), '#43')!.next).toBe(
				'next: staging after bake · staging is held · ~7m'
			);
			at(m, 'staging').state = 'awaiting-approval';
			expect(flight(rebuild(m), '#43')!.next).toBe(
				'next: staging after bake, needs approval · ~7m'
			);
		});
	});

	it('passed: never waits on a newer build baking or deploying in the same env', () => {
		for (const f of build().home.allFlights)
			expect(f.next, f.ref).not.toMatch(/after #\d+'s (bake|deploy)/);
	});
});

describe('decision 1 (c): Needs you is your own failing changes only', () => {
	it('holds #37 eu-west and #14 staging, with remedy buttons (hello prod fails on anna-ward\'s #13)', () => {
		const { home } = build();
		expect(
			home.needs.map((n) => [
				n.app,
				n.place,
				n.word,
				n.cause,
				n.why === 'starred' ? n.why : n.why.ref,
				n.action.label
			])
		).toEqual([
			[
				'invoice-api',
				'prod eu-west',
				'Failing',
				'error-rate check failing',
				'#37',
				'Roll back eu-west'
			],
			[
				'checkout-worker',
				'staging',
				'Failing',
				'prometheus-high-error-rate check failing',
				'#14',
				'Roll back staging'
			]
		]);
		// they are carried by Needs you and drawn in Your changes as a stub only
		expect(flight(home, '#37')!.inNeeds).toBe(true);
		expect(flight(home, '#13')).toBeUndefined();
		expect(flight(home, '#14')!.inNeeds).toBe(true);
	});

	it("hello-frontend-app's prod failure is not in Needs you or Watch: the failing build is anna-ward's #13, a line under the live row", () => {
		const { home } = build();
		expect(home.needs.some((x) => x.app === 'hello-frontend-app')).toBe(false);
		expect(home.watch.some((x) => x.app === 'hello-frontend-app')).toBe(false);
		const g = home.allLive.find((x) => x.app === 'hello-frontend-app')!;
		expect(g.others.map((o) => `${o.kind} ${o.kindWord}${o.sub}`)).toEqual([
			'failed failing · error-rate check · 20m'
		]);
	});

	it('does the same with nothing starred', () => {
		const { home } = build(new Set());
		expect(home.needs.map((n) => n.app)).toEqual(['invoice-api', 'checkout-worker']);
		expect(home.watch.some((x) => x.app === 'hello-frontend-app')).toBe(false);
	});
});

describe('decision 2 (d): no approving your own change', () => {
	it('#40 sits in Your changes with an Open link and no Review action anywhere', () => {
		const { home } = build();
		const f = flight(home, '#40')!;
		expect(f.kind).toBe('approval');
		expect(f.inNeeds).toBe(false);
		expect(home.needs.some((n) => n.kind === 'approval')).toBe(false);
		expect(JSON.stringify(home)).not.toContain('Review approval');
	});
});

describe('decision 3 (e): stuck held changes are tier 1 in Your changes', () => {
	it('#28 is stuck, at full weight, with Open check, not in Needs you', () => {
		const { home } = build();
		for (const ref of ['#28']) {
			const f = flight(home, ref)!;
			expect([f.stuck, f.inNeeds, f.link?.label], ref).toEqual([true, false, 'Open check']);
			expect(home.needs.some((n) => n.why !== 'starred' && n.why.ref === ref)).toBe(false);
		}
	});
});

describe('decision 4 (f): no other-team approval on Home', () => {
	it('payments-core approval is nowhere: not Needs you, Watch, Rolling out, status', () => {
		const { model, home } = build();
		// the fixture does hold that approval (telemetry-indexer's is the viewer's own #20 now)
		const pc = model.apps.find((a) => a.app === 'payments-core')!;
		expect(pc.envs.some((e) => e.state === 'awaiting-approval')).toBe(true);
		expect(home.needs.some((n) => n.app === 'payments-core')).toBe(false);
		expect(home.watch.some((w) => w.app === 'payments-core' || w.kind === 'approval')).toBe(false);
		expect(home.rolling.some((r) => r.app === 'payments-core' && r.step === 'approval')).toBe(
			false
		);
		expect(home.status.text).not.toMatch(/approval/);
		// only the viewer's own changes may wait for approval on Home: #40, and #20 on telemetry-indexer
		expect(home.allFlights.filter((f) => f.kind === 'approval').map((f) => f.ref)).toEqual([
			'#40',
			'#20'
		]);
	});
});

/**
 * THE EARLY SIGNAL (Home's third question, "is anything starting to go wrong?").
 * standalone-api prod is held by its RolloutDependency on ledger-core, as the
 * rollout-controller's RolloutDependency reconciler writes it: ledger-core prod
 * serves 5.1.0, s-11 needs >=5.4.0 and s-12 ^6.0.0, so the gate admits only s-10
 * and Satisfied is False (WaitingForProvider) since s-11 arrived at 11:41, 8h
 * before capture. Nobody in the fixture is the viewer on it, so it is a Watch line
 * and touches neither Needs you nor Your changes.
 */
describe('the early signal: standalone-api held on ledger-core', () => {
	it('is the first Watch line, worded actual (held 8h) against what it waits for (ledger-core)', () => {
		for (const starred of [new Set<string>(), LAB_STARRED]) {
			const { home } = build(starred);
			// telemetry-collector's flapping check is no Watch line: the viewer's #20 runs there (hc-v2, below)
			expect(home.watch).toHaveLength(1);
			const w = home.watch[0];
			expect(w).toMatchObject({
				app: 'standalone-api',
				appHref: '/apps/standalone-api',
				kind: 'held',
				kindWord: 'held',
				place: 'prod',
				age: '8h',
				href: '/rollouts/prod/standalone-prod/standalone-api',
				facts: { kind: 'held', reason: 'dependency', provider: 'ledger-core' }
			});
			expect(`${w.app} · ${w.place} · ${w.kindWord}${w.sub}`).toBe(
				'standalone-api · prod · held · on ledger-core · 8h'
			);
			expect(home.watchShown).toEqual(home.watch);
			expect(home.watchMore).toBe(0);
		}
	});

	it('is not the viewer’s: no Needs you, no Your changes, no change of theirs in its repo', () => {
		const { home } = build();
		const input = homeInput();
		expect(home.needs.some((n) => n.app === 'standalone-api')).toBe(false);
		expect(yoursApps(home)).not.toContain('standalone-api');
		expect(
			input.changes.filter((c) => c.repo === 'standalone-api' && c.author === input.me)
		).toEqual([]);
	});

	it('is what the fixture’s controllers wrote: the gate admits only what ledger-core 5.1.0 satisfies', () => {
		const input = homeInput();
		const dep = input.rolloutDependencies.items.find(
			(d) => d.metadata?.namespace === 'standalone-prod'
		)!;
		expect(dep.status?.providedVersion).toBe('5.1.0');
		expect(dep.status?.admittedVersions).toEqual(['s-10']);
		expect(dep.status?.blockedReleases?.map((b) => `${b.tag} ${b.requiredVersion}`)).toEqual([
			's-11 >=5.4.0',
			's-12 ^6.0.0'
		]);
		const sat = dep.status?.conditions?.find((c) => c.type === 'Satisfied');
		expect(sat).toMatchObject({ status: 'False', reason: 'WaitingForProvider' });
		const r = input.rollouts.find((x) => x.metadata?.namespace === 'standalone-prod')!;
		expect(r.status?.history?.[0]?.version?.tag).toBe('s-10');
		expect(r.status?.gates).toEqual([
			{
				name: 'dependency-standalone-api-needs-ledger',
				passing: true,
				allowedVersions: ['s-10'],
				message: 'Gate does not allow any release candidate'
			}
		]);
		// held since the first refused build arrived, i.e. when Satisfied went False
		const s11 = r.status?.availableReleases?.find((x) => x.tag === 's-11');
		expect(s11?.created).toBe(sat?.lastTransitionTime);
		expect(input.environments.filter((e) => e.metadata?.namespace === 'standalone-prod')).toHaveLength(1);
	});
});

describe('decision 5 (g): status line is fleet health only', () => {
	it('reads 3 failing · 36 of 38 prod healthy', () => {
		const { home } = build();
		// standalone-api prod counts: held, but running s-10 without fault
		expect(home.status).toMatchObject({ failing: 3, healthy: 36, total: 38 });
		expect(home.status.text).toBe('3 failing · 36 of 38 prod healthy');
	});

	it('drops the failing part when nothing fails', () => {
		const { model } = build();
		const m = structuredClone(model);
		for (const a of m.apps) for (const e of a.envs) if (e.state === 'failed') e.state = 'healthy';
		expect(buildLumenHome(m, new Date(homeInput().now)).status.text).toBe('36 of 38 prod healthy');
	});
});

describe('unfinished / live (h)', () => {
	it('splits 17 changes into 11 in progress and 6 live', () => {
		// hc HC-1: 20/13 again. fix8 F1 had 19/12 after #41 fell out of fix 3's two-per-env cap;
		// an unfinished change is never capped out, so #41 (staging, not in prod) is in progress
		// (authors follow the mock GitHub endpoint: 17 -> 11 in progress, 6 live; #81 and #13 are
		// someone else's now, #20 is the viewer's on four telemetry apps)
		const { home } = build();
		expect(home.totals).toMatchObject({ changes: 17, inFlight: 11, live: 6 });
		expect(home.totals.text).toBe('17 changes · 11 in progress · 6 live');
		const inFlight = new Set(home.allFlights.map((f) => f.ref));
		expect(inFlight.size).toBe(11);
		const live = new Set(
			[...home.busy, ...home.allLive]
				.flatMap((g) => g.live.map((l) => l.ref))
				.filter((r) => !inFlight.has(r))
		);
		expect([...live].sort()).toEqual(['#29', '#36', '#39', '#89', '8375506', 'b17b002']);
	});
});

describe('merged but unreleased (i)', () => {
	it('is not counted and not drawn', () => {
		const { model, home } = build();
		const unreleased = model.apps.flatMap((a) => a.merged.map((c) => c.ref));
		// a11ca10 has no build yet; #13/#80/#81/8375506 match builds by revision
		expect(unreleased.sort()).toEqual(['a11ca10']);
		const drawn = new Set([
			...home.allFlights.map((f) => f.ref),
			...[...home.busy, ...home.allLive].flatMap((g) => g.live.map((l) => l.ref))
		]);
		for (const ref of unreleased) expect(drawn.has(ref), ref).toBe(false);
	});
});

describe('shared change (j)', () => {
	it('the billing change is counted and listed once, its two apps one landed group', () => {
		const { home } = build();
		expect(home.landed.filter((l) => l.ref === 'b17b002')).toHaveLength(1);
		expect(home.landedGroups.find((g) => g.key === 'b17b002')).toEqual({
			key: 'b17b002',
			apps: ['billing-api', 'billing-worker'],
			n: 1
		});
		expect(home.totals.changes).toBe(17);
	});
});

describe('starred from the caller (k)', () => {
	it('places a starred app in the starred tier and flags its lines', () => {
		const { model, home } = build(new Set(['payments-core']));
		expect(model.apps.find((a) => a.app === 'payments-core')!.tier).toBe('starred');
		expect(home.rolling.find((r) => r.app === 'payments-core')!.starred).toBe(true);
		// starred rolling lines sort first
		expect(home.rolling[0].app).toBe('payments-core');
	});

	it('an empty set stars nothing', () => {
		const { model, home } = build(new Set());
		expect(model.apps.find((a) => a.app === 'payments-core')!.tier).toBe('active');
		// tier "starred" is then exactly "has a change of yours"
		for (const a of model.apps) {
			const mine = a.envs.some((e) => e.myChanges.length > 0) || a.merged.length > 0;
			expect(a.tier === 'starred', a.app).toBe(mine);
		}
		expect([...home.watch, ...home.rolling, ...home.quiet].some((x) => x.starred)).toBe(false);
	});

	it('defaults to nothing starred when the option is omitted', () => {
		const input = homeInput();
		const home = buildLumenHome(buildHomeModel(input), input.now);
		expect([...home.watch, ...home.rolling, ...home.quiet].some((x) => x.starred)).toBe(false);
	});
});

describe('watchSub', () => {
	it('words each Watch kind', () => {
		const { home } = buildSlowBake();
		expect(home.watch.map((w) => `${w.kindWord}${w.sub}`)).toEqual([
			'held · on ledger-core · 8h',
			'slow bake · 75m, set to 60m'
		]);
		const line = {
			key: 'k',
			app: 'a',
			appHref: '/apps/a',
			place: 'prod',
			places: ['prod'],
			href: '/',
			age: '',
			ageMs: 0
		};
		expect(
			watchSub({
				...line,
				kind: 'failed',
				evidence: 'a-error-rate failing',
				facts: { kind: 'signal', signal: { kind: 'check-failing', check: 'a-error-rate' } },
				age: '30m',
				sev: 0
			})
		).toBe(' · error-rate check · 30m');
		expect(
			watchSub({
				...line,
				kind: 'rolledback',
				evidence: 'rolled back to 4.40.0-40',
				facts: { kind: 'rolled-back', version: '4.40.0-40' },
				age: '5h',
				sev: 1
			})
		).toBe(' · 5h ago');
		expect(
			watchSub({
				...line,
				kind: 'held',
				evidence: 'waits on a dependency',
				facts: { kind: 'held', reason: 'dependency' },
				age: '6h',
				sev: 3
			})
		).toBe(' · on a dependency · 6h');
		expect(
			watchSub({
				...line,
				kind: 'held',
				evidence: 'waits on a dependency',
				facts: { kind: 'held', reason: 'dependency', provider: 'payments-svc' },
				age: '6h',
				sev: 3
			})
		).toBe(' · on payments-svc · 6h');
		expect(
			watchSub({
				key: 'k',
				kind: 'held',
				app: 'a',
				appHref: '/apps/a',
				place: 'dev',
				places: ['dev'],
				evidence: 'waits on promotion order',
				facts: { kind: 'held', reason: 'order' },
				age: '',
				ageMs: 0,
				href: '/',
				sev: 3
			})
		).toBe(' · on promotion order');
	});
});

describe('one age per failure (l)', () => {
	it('Needs you and Your changes date a failure from when it began failing, not from the deploy', () => {
		const { home } = build(new Set());
		const age = (app: string) => home.needs.find((n) => n.app === app)?.age;
		// hello prod: deployed 19:11, bake failed 19:21:32, now 19:41:32. The failing build carries
		// anna-ward's #13, so it is no Needs you row of the viewer's: the failure is a line under
		// hello-frontend-app's live row, dated the same way
		expect(age('hello-frontend-app')).toBeUndefined();
		expect(flight(home, '#13')).toBeUndefined();
		expect(
			home.allLive.find((g) => g.app === 'hello-frontend-app')!.others.map((o) => o.age)
		).toEqual(['20m']);
		// checkout-worker staging: deployed 19:38:32, failed 19:39:32
		expect(age('checkout-worker')).toBe('2m');
		expect(flight(home, '#14')?.age).toBe('2m');
		// invoice-api eu-west: deployed 10:32:26, failed 10:33:26 (fix8: re-timed to when the
		// controller, with no gate there, would take a11c202) — 9h either way
		expect(age('invoice-api')).toBe('9h');
		expect(flight(home, '#37')?.age).toBe('9h');
		for (const n of home.needs) {
			if (n.why === 'starred') continue;
			expect(flight(home, n.why.ref)?.age, n.key).toBe(n.age);
		}
	});
});

describe('a change held from a prod region (m)', () => {
	// #81 on checkout-api is sam-oliver's in the corrected fixture, not the viewer's: the hold on
	// payments-svc in ap-southeast-2 and us-east-1 is a fact about someone else's change, drawn as
	// a line under checkout-api's row (see (n)). The viewer's own held-from-a-prod-region story is #28.
	it('#81 waits on payments-svc in two prod regions but is not yours: no row, no flight, no tier 1', () => {
		for (const starred of [new Set<string>(), LAB_STARRED]) {
			const { model, home } = build(starred);
			const app = model.apps.find((a) => a.app === 'checkout-api')!;
			for (const env of app.envs)
				expect(
					env.myChanges.find((c) => c.ref === '#81'),
					env.env
				).toBeUndefined();
			expect(flight(home, '#81')).toBeUndefined();
			const group = home.busy.find((g) => g.app === 'checkout-api')!;
			expect(group.flights.map((x) => x.ref)).toEqual(['#80']);
			// never in Needs you (no remedy on Home), and its app is not repeated in Watch
			expect(home.needs.some((n) => n.app === 'checkout-api')).toBe(false);
			expect(home.watch.some((w) => w.app === 'checkout-api')).toBe(false);
		}
	});

	it('#80 is not held: in bake in us-east-2, and the af-south-1 rollback (b-41, #79) is not yours', () => {
		const { model, home } = build(new Set());
		// checkout-api prod bakes are 30m (fix7 B3): 25m in, 5 left
		expect(line(flight(home, '#80')!)).toBe('in bake · 25m · next: live after bake · ~5m');
		const af = model.apps
			.find((a) => a.app === 'checkout-api')!
			.envs.find((e) => e.env === 'prod-af-south-1')!;
		expect(af.state).toBe('rolled-back');
		expect(af.myChanges).toEqual([]);
	});
});

describe('facts on an app of yours that no row of yours carries (n)', () => {
	it("checkout-api keeps someone else's af-south-1 rollback and the whole payments-svc hold (#81 is sam-oliver's)", () => {
		for (const starred of [new Set<string>(), LAB_STARRED]) {
			const { home } = build(starred);
			const g = home.busy.find((x) => x.app === 'checkout-api')!;
			// b-41 (#79, anna-ward) rolled back at 14:41; staging refuses b-44/b-45 (#82, #83).
			// The hold names its provider off staging's own dependency gate. No row of yours is held
			// at ap-southeast-2 or us-east-1 (b-43 is #81, not yours), so one line keeps all three places.
			expect(g.others.map((o) => `${o.kind} ${o.place} ${o.kindWord}${o.sub}`)).toEqual([
				'rolledback prod af-south-1 rolled back · 5h ago',
				'held staging, prod ap-southeast-2, prod us-east-1 held · on payments-svc · 6h'
			]);
			expect(g.others[1].facts).toEqual({
				kind: 'held',
				reason: 'dependency',
				provider: 'payments-svc'
			});
			expect(g.others.every((o) => o.notYours)).toBe(true);
			expect(g.others[0].href).toBe('/rollouts/prod/checkout-api-prod-af-south-1/checkout-api');
			expect(g.others[1]).toMatchObject({
				places: ['staging', 'prod ap-southeast-2', 'prod us-east-1'],
				href: '/rollouts/staging/checkout-api-staging/checkout-api'
			});
			expect(home.watch.some((w) => w.app === 'checkout-api')).toBe(false);
		}
	});

	it("a held line that keeps only some places is aged from those places' hold start", () => {
		const { model: base } = build(new Set());
		const now = new Date(homeInput().now);
		// #81 is no longer the viewer's, so no row of yours is held at ap-southeast-2 and us-east-1:
		// give the viewer a held change there (as the fixture did before) so only staging is kept
		const model = structuredClone(base);
		const app = model.apps.find((a) => a.app === 'checkout-api')!;
		for (const env of ['prod-ap-southeast-2', 'prod-us-east-1']) {
			const e = app.envs.find((x) => x.env === env)!;
			e.myChanges = [{ ...e.myChanges[0], ref: '#81', state: 'held-by-rule' }];
		}
		const staging = app.envs.find((e) => e.env === 'staging')!;
		// staging refuses b-44 since it was built (13:41); the build running there arrived at 18:11
		expect([staging.heldSince, staging.arrivedAt]).toEqual([
			'2026-10-24T13:41:26.893Z',
			'2026-10-24T18:11:26.893Z'
		]);
		const kept = (m: HomeModel) =>
			buildLumenHome(m, now)
				.busy.find((x) => x.app === 'checkout-api')!
				.others.find((o) => o.kind === 'held')!;
		expect(kept(model)).toMatchObject({
			places: ['staging'],
			age: '6h',
			ageMs: now.getTime() - Date.parse('2026-10-24T13:41:26.893Z')
		});
		// its own start, not the app's figure: a hold begun 30m ago reads 30m
		const m = structuredClone(model);
		const st = m.apps.find((a) => a.app === 'checkout-api')!.envs.find((e) => e.env === 'staging')!;
		st.heldSince = new Date(now.getTime() - 30 * 60_000).toISOString();
		expect(kept(m)).toMatchObject({ age: '30m', ageMs: 30 * 60_000 });
		// and no hold start, no age
		st.heldSince = null;
		expect(kept(m)).toMatchObject({ age: '', ageMs: 0 });
	});

	it('a fact your row carries is not repeated: invoice-api, checkout-worker and recommender-svc have none', () => {
		const { home } = build(new Set());
		for (const app of ['invoice-api', 'recommender-svc', 'checkout-worker'])
			expect(home.busy.find((x) => x.app === app)!.others, app).toEqual([]);
	});
});
