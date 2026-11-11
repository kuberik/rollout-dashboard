import { afterEach, describe, expect, it } from 'vitest';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource, homeModel, resetHomeModel } from '$lib/components/home/sketch/home-data';
import { approvalTarget, placeHolds, rollouts } from './data';
import { applySlicesMode } from '$lib/demo/mock-slices';
import {
	ingestReleaseSlices,
	ingestReleaseSources,
	resetReleaseCatalogue
} from '$lib/releases/registry.svelte';

/**
 * The four reads the merge moved from `status.releaseCandidates` onto the catalogue accessors (data.ts: `failedWaveCand`, the
 * `approvalGateOf` input behind `gateName`, `candidatesOf`; rollout-cards.ts: `liveForPlace(r, releaseCandidates(r) ?? [], fleet)`),
 * proven on the two shapes the product serves, never through the legacy test adapter:
 *   - a Rollout WITH `spec.releaseSourceRef` whose releases are ReleaseSlices (candidates = the catalogue after the deployed build);
 *   - a real no-source Rollout (no ref, the controller's ReleaseSourceRequired condition): no releases, so no candidates, no holds.
 * A revert to a direct `status.releaseCandidates` read passes neither.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const REQUIRED = {
	type: 'ReleasesUpdated',
	status: 'False',
	reason: 'ReleaseSourceRequired',
	message: 'spec.releaseSourceRef is not set, so this Rollout has no releases.'
};

/** Serve `old` (old-shape fixtures) the way the product does: slices + a ref, or (withSource false) a real no-source Rollout. */
const serve = (old: any[], withSource: boolean, environments?: any[]) => {
	const fx = fixtureSource();
	const m = applySlicesMode(old);
	resetReleaseCatalogue();
	ingestReleaseSources(m.sources as any, { replaceAll: true });
	ingestReleaseSlices(m.slices as any, []);
	const served = withSource
		? m.rollouts
		: (m.rollouts as any[]).map((r) => {
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
