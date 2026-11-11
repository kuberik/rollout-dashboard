import { afterEach, describe, expect, it } from 'vitest';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource, homeModel, resetHomeModel } from '$lib/components/home/sketch/home-data';
import { apps, approvalTarget, gateName, pathPosition, placeHolds, regionStates, rollouts, runsIn } from './data';
import { regionSquares } from './change-truth';
import { envPage } from './env/env-page';
import { applySlicesMode } from '$lib/demo/mock-slices';
import {
	ingestReleaseSlices,
	ingestReleaseSources,
	resetReleaseCatalogue
} from '$lib/releases/registry.svelte';

/**
 * The four reads the merge moved from `status.releaseCandidates` onto the catalogue accessors, and what each test pins:
 *   - `failedWaveCand` (data.ts): "the wave hold" test (a failed build that exists only as a catalogue candidate holds the wave leader);
 *   - `candidatesOf` (data.ts): "approvalTarget names the deploy tag value" (the `deploys` build is the candidate's `version`, which differs from its tag);
 *   - the `approvalGateOf` input behind `gateName` (data.ts): "gateName picks the approval gate by name" (gates WITHOUT `kind`, where only
 *     the candidate-aware `own` can tell the approval gate from the other refusers);
 *   - `liveForPlace(r, releaseCandidates(r) ?? [], fleet)` (rollout-cards.ts): the place verdict test.
 * Proven on the two shapes the product serves, never through the legacy test adapter:
 *   - a Rollout WITH `spec.releaseSourceRef` whose releases are ReleaseSlices (candidates = the catalogue after the deployed build);
 *   - a real no-source Rollout (no ref, the controller's ReleaseSourceRequired condition): no releases, so no candidates, no holds.
 * Each of the four reads, reverted to `status.releaseCandidates`, fails one of these tests; the last describe pins the no-releases
 * place's currency (excluded from "newest" and "behind") on every consumer.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const REQUIRED = {
	type: 'ReleasesUpdated',
	status: 'False',
	reason: 'ReleaseSourceRequired',
	message: 'spec.releaseSourceRef is not set, so this Rollout has no releases.'
};

/** Serve `old` (old-shape fixtures) the way the product does: slices + a ref, or (withSource false) a real no-source Rollout. */
const serve = (old: any[], withSource: boolean | ((r: any) => boolean), environments?: any[]) => {
	const fx = fixtureSource();
	const m = applySlicesMode(old);
	resetReleaseCatalogue();
	ingestReleaseSources(m.sources as any, { replaceAll: true });
	ingestReleaseSlices(m.slices as any, []);
	const keep = (r: any) => (typeof withSource === 'function' ? withSource(r) : withSource);
	const served = (m.rollouts as any[]).map((r) => {
		if (keep(r)) return r;
		const { releaseSourceRef: _ref, ...spec } = r.spec ?? {};
		return {
			...r,
			spec,
			status: {
				...r.status,
				candidates: undefined,
				conditions: [...(r.status?.conditions ?? []), REQUIRED]
			}
		};
	});
	installLiveSource({
		...fx,
		rollouts: served as any,
		environments: environments ?? fx.environments
	} as any);
	resetHomeModel();
};
afterEach(() => {
	installLiveSource(null);
	resetReleaseCatalogue();
	resetHomeModel();
});

describe('payments-core: the approval holds read the catalogue', () => {
	const held = () =>
		placeHolds('payments-core', 'incident').filter(
			(p) => p.label === 'ap-south' || p.label === 'us-east'
		);
	const prodRow = () =>
		rollouts('incident').rows.find((r) => r.app === 'payments-core' && r.tier === 'prod')!;

	it('with a releaseSourceRef: the newer builds are held by the approval gate, which gateName names, and a target exists (candidatesOf, approvalGateOf)', () => {
		serve(fixtureSource().rollouts as any[], true);
		for (const p of held()) {
			expect(p.heldBuilds.length, p.label).toBeGreaterThan(0);
			expect(p.holdReason, p.label).toBe('approval');
			expect(p.gate?.name, p.label).toBe('Release approval');
		}
		expect(approvalTarget(prodRow(), 'incident')).toBeTruthy();
	});

	it('the place verdict (liveForPlace over releaseCandidates) reads the catalogue: a verdict with a target build', () => {
		serve(fixtureSource().rollouts as any[], true);
		const envs = homeModel('incident').apps.find((a) => a.app === 'payments-core')!.envs;
		const pv = envs.find((e) => e.href === held()[0].href)!.placeVerdict;
		expect(pv, 'a held approval place has a verdict').toBeTruthy();
		expect(pv!.target).toBeTruthy();
	});

	it('a real no-source Rollout: no candidates, so nothing is held, no gate is named, no target, no verdict', () => {
		serve(fixtureSource().rollouts as any[], true);
		const row = prodRow();
		serve(fixtureSource().rollouts as any[], false);
		for (const p of held()) {
			expect(p.heldBuilds, p.label).toEqual([]);
			expect(p.holdReason, p.label).not.toBe('approval');
		}
		expect(approvalTarget(row, 'incident')).toBeNull();
		const envs = homeModel('incident').apps.find((a) => a.app === 'payments-core')!.envs;
		expect(envs.find((e) => e.href === row.href)!.placeVerdict ?? null).toBeNull();
	});
});

/** checkout-api's wave: eu-central (wave 1) failed the bake of build B; the leader of wave 2 is held by it (failedWaveCand). */
const waveFailure = () => {
	const fx = fixtureSource();
	const P = placeHolds('checkout-api', 'incident');
	const lead = P.find((p) => p.label === 'ap-southeast-2')!;
	const first = P.find((p) => p.label === 'eu-central')!;
	const part = (href: string) => {
		const [, , ns, name] = href.split('/').filter(Boolean);
		return { ns, name };
	};
	const L = part(lead.href);
	const F = part(first.href);
	const rev = 'eeeeeee0000000';
	const raw = fx.rollouts as any[];
	const leadRaw = raw.find((r) => r.metadata.namespace === L.ns && r.metadata.name === L.name);
	const firstRaw = raw.find((r) => r.metadata.namespace === F.ns && r.metadata.name === F.name);
	const failedV = { ...leadRaw.status.releaseCandidates[0], revision: rev };
	const wave2 = new Set(
		P.filter((p) => p.wave?.wave === 2).map((p) => `${part(p.href).ns}/${part(p.href).name}`)
	);
	const withBuild = (r: any, extra: any) => ({
		...r,
		status: {
			...r.status,
			releaseCandidates: [failedV],
			/* oldest first, as the slices carry them: the failed build is the newest */
			availableReleases: [
				...(r.status.availableReleases ?? []).filter((v: any) => v.tag !== failedV.tag),
				failedV
			],
			...extra
		}
	});
	const edited = raw.map((r) => {
		if (wave2.has(`${r.metadata.namespace}/${r.metadata.name}`))
			return withBuild(r, {
				gates: [{ name: 'promotion-staging', passing: true, allowedVersions: ['b-44'] }]
			});
		if (r === leadRaw) return withBuild(r, {});
		if (r === firstRaw)
			return withBuild(r, {
				currentVersion: failedV.tag ?? failedV.version,
				history: [
					{
						bakeStatus: 'Failed',
						version: failedV,
						timestamp: new Date(Date.now() - 60000).toISOString()
					},
					...(r.status.history ?? [])
				]
			});
		return r;
	});
	const environments = (fx.environments as any[]).map((e) =>
		e.metadata.namespace === L.ns && e.spec?.rolloutRef?.name === L.name
			? {
					...e,
					status: {
						...e.status,
						conditions: [
							{ type: 'WaveReady', status: 'False', reason: 'WaitingFor', message: 'bake failed' }
						],
						wave: {
							...(e.status?.wave ?? {}),
							blocker: {
								reason: 'WaitingFor',
								environment: 'prod',
								site: first.label,
								waitingOn: 'Bake',
								revision: rev
							}
						}
					}
				}
			: e
	);
	return { edited, environments, leadLabel: lead.label };
};

describe('checkout-api: the wave hold (failedWaveCand) reads the catalogue', () => {
	it('with a releaseSourceRef: the failed build is a catalogue candidate, so the leader is held by the wave', () => {
		const { edited, environments, leadLabel } = waveFailure();
		serve(edited, true, environments);
		const p = placeHolds('checkout-api', 'incident').find((x) => x.label === leadLabel)!;
		expect(p.upstreamFailed).toBeTruthy();
	});

	it('a real no-source Rollout: no candidate to fail on, so no wave hold and no held builds', () => {
		const { edited, environments, leadLabel } = waveFailure();
		serve(edited, false, environments);
		const p = placeHolds('checkout-api', 'incident').find((x) => x.label === leadLabel)!;
		expect(p.upstreamFailed ?? null).toBeNull();
		expect(p.heldBuilds).toEqual([]);
	});
});

/**
 * Each place's own truth wins: a place whose Rollout has no releases is "No releases yet" everywhere and is NOT COUNTED as "on the newest"
 * (no release = not affected), even when it runs the same build as a place that has releases.
 */
describe('mixed app: one place has no releases, another on the same build has', () => {
	const APP = 'payments-core';
	/** a place that IS on the newest build while it has releases */
	const setup = () => {
		const rs = fixtureSource().rollouts as any[];
		serve(rs, true);
		const base = apps('incident').items.find((a) => a.app === APP)!;
		const on = base.placeList.find((p) => p.onNewest)!;
		const victim = rs.find((r) => on.href.endsWith(`${r.metadata.namespace}/${r.metadata.name}`))!;
		const baseN = Number(
			/of (\d+) place/.exec(pathPosition(rollouts('incident').rows.find((r) => r.app === APP)!))![1]
		);
		const same = (r: any) =>
			r.metadata.namespace === victim.metadata.namespace &&
			r.metadata.name === victim.metadata.name;
		serve(rs, (r) => !same(r));
		return { href: on.href, total: baseN };
	};
	it('the app list does not count the no-release place on the newest, and the app page rollup excludes it', () => {
		const { href, total } = setup();
		const item = apps('incident').items.find((a) => a.app === APP)!;
		const place = item.placeList.find((p) => p.href === href)!;
		expect(place.onNewest).toBe(false);
		expect(place.onBuild).toBe(false);
		const row = rollouts('incident').rows.find((r) => r.app === APP)!;
		const text = pathPosition(row);
		expect(text).toMatch(new RegExp(`of ${total - 1} place`));
	});
});

/** the payments-core prod places that carry candidates, edited by `f` (the rest of the fleet untouched) */
const prodEdit = (f: (r: any) => any) =>
	(fixtureSource().rollouts as any[]).map((r) =>
		/^payments-core-prod-/.test(r.metadata.namespace) &&
		r.metadata.namespace !== 'payments-core-prod-sa-east' &&
		r.status.releaseCandidates?.length
			? f(r)
			: r
	);
const renamed = (list: any[] | undefined) =>
	(list ?? []).map((x) => (x.tag === 'f4a2c19' ? { ...x, tag: 'v9.9.9' } : x));

describe('the moved reads, pinned by value', () => {
	it('approvalTarget names the deploy tag value: the candidate version, not its tag (candidatesOf)', () => {
		/* the approval gate allows the newest candidate (tag v9.9.9, version f4a2c19) but not the build in question: approving it deploys f4a2c19 */
		const rs = prodEdit((r) => ({
			...r,
			status: {
				...r.status,
				releaseCandidates: renamed(r.status.releaseCandidates),
				availableReleases: renamed(r.status.availableReleases),
				gates: [{ ...r.status.gates[0], allowedVersions: ['v9.9.9'] }]
			}
		}));
		serve(rs, true);
		const row = rollouts('incident').rows.find((r) => r.app === 'payments-core' && r.tier === 'prod')!;
		expect(approvalTarget(row, 'incident')?.deploys).toBe('f4a2c19');
	});

	it('gateName picks the approval gate by name when no gate has a kind (approvalGateOf over the catalogue candidates)', () => {
		/* [a legacy approval that already allows every candidate, a freeze window, the approval that refuses them]: only `own` (the
		   approval gate that refuses EVERY candidate) names the third; without the candidates the first approval-named gate wins and the
		   row is blamed on the freeze window */
		const rs = prodEdit((r) => ({
			...r,
			status: {
				...r.status,
				gates: [
					{ name: 'approval-legacy', allowedVersions: [...r.status.releaseCandidates.map((x: any) => x.tag), '9b7e410'], passing: true },
					{ name: 'freeze-window', allowedVersions: ['9b7e410'] },
					{ name: 'release-approval', allowedVersions: ['9b7e410'] }
				]
			}
		}));
		serve(rs, true);
		const row = rollouts('incident').rows.find(
			(r) => r.app === 'payments-core' && r.tier === 'prod' && r.state === 'awaiting-approval'
		)!;
		expect(gateName(row, 'incident')?.name).toBe('Release approval');
	});
});

/**
 * B1 (ruling): a place WITHOUT releases is EXCLUDED from currency (`currency: 'none'`): neither newest nor behind. One mixed fixture per
 * consumer: that place has no releases, its siblings have. Each consumer must skip it.
 */
describe('a place without releases is excluded from currency', () => {
	const hrefOf = (app: string, pick: (p: any) => boolean) => {
		serve(fixtureSource().rollouts as any[], true);
		return apps('quiet').items.find((a) => a.app === app)!.placeList.find(pick)!.href;
	};
	/** serve the fleet with the Rollout behind `href` stripped of its release source */
	const without = (href: string) => {
		const rs = fixtureSource().rollouts as any[];
		const victim = rs.find((r) => href.endsWith(`${r.metadata.namespace}/${r.metadata.name}`))!;
		serve(rs, (r) => !(r.metadata.namespace === victim.metadata.namespace && r.metadata.name === victim.metadata.name));
	};
	const tierHref = (app: string, tier: string) => hrefOf(app, (p) => p.tier === tier);

	it('apps(): it is never the promotion target ("Ready to promote to dev · 1 behind")', () => {
		const href = tierHref('billing-worker', 'dev');
		without(href);
		const item = apps('quiet').items.find((a) => a.app === 'billing-worker')!;
		const place = item.placeList.find((p) => p.href === href)!;
		expect(item.fact).not.toMatch(/Ready to promote|behind/);
		expect(item.behind).toBeNull();
		expect(place.currency).toBe('none');
	});

	it('runsIn(): it carries no currency word', () => {
		const href = tierHref('billing-worker', 'dev');
		without(href);
		expect(runsIn('billing-worker', 'quiet').find((r) => r.href === href)!.word).toBe('');
	});

	it('regionStates / regionSquares: the prod square is health only, never "behind" or "not reached"', () => {
		const href = tierHref('telemetry-collector', 'prod');
		without(href);
		expect(regionStates('telemetry-collector', 'quiet').find((r) => r.href === href)!.currency).toBe('none');
		const sq = regionSquares('telemetry-collector', 'quiet');
		expect(sq.inks).not.toContain('behind');
		expect(sq.sentence).not.toMatch(/not reached|behind/);
	});

	it('/envs: it does not count as behind and says "No releases yet" on the at-rest row', () => {
		const href = tierHref('billing-api', 'dev');
		without(href);
		const rest = envPage('quiet', 'dev')!.atRest.filter((x) => x.app === 'billing-api');
		expect(rest.length).toBe(1);
		expect(rest[0].sentence).toBe('No releases yet');
	});
});
