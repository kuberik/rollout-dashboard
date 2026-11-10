import { describe, it, expect } from 'vitest';
import {
	journeyFromCells,
	journeyFromChange,
	journeyFromLane,
	nodeStateFromCell,
	pickFrontier,
	pickNext,
	needsCallout,
	isReached,
	reachedLabel,
	frontierLabel,
	frontierStateWord,
	journeyFrontier,
	queuedLabel,
	roughLabel,
	type JourneyStop
} from './journey';
import type { PrCell, PrService } from './pr-pipeline';
import { buildLanes, laneTiers, type Tier } from './promotion-lanes';
import { buildRolloutCards } from '../rollout-cards';
import type { Rollout, Environment } from '../../types';

const TIERS: Tier[] = ['dev', 'test', 'staging', 'other', 'prod'];
const NOW = new Date('2026-10-10T12:00:00Z');

function mkCell(overrides: Partial<PrCell> & Pick<PrCell, 'envName' | 'state'>): PrCell {
	return {
		cluster: 'local',
		namespace: `ns-${overrides.envName}`,
		rolloutName: 'hello-app',
		theme: null,
		envRank: 0,
		reason: '',
		since: null,
		usuallyMs: null,
		bakeLeftMs: null,
		releaseLabel: '',
		revision: null,
		superseded: false,
		supersededHeadStatus: null,
		gateHint: null,
		gateLabel: null,
		gateSubject: null,
		gateSubjectKind: null,
		gatePending: false,
		gateApprovalGuess: false,
		gateContract: null,
		gateRequiredVersion: null,
		gateProvidedVersion: null,
		providerHasNoBuild: false,
		containmentKnown: true,
		envDisplay: overrides.envName,
		...overrides
	} as PrCell;
}

function service(cells: PrCell[]): Pick<PrService, 'cells'> {
	return { cells };
}

describe('nodeStateFromCell', () => {
	it('maps every PrState per the table', () => {
		const table: Array<[PrCell['state'], ReturnType<typeof nodeStateFromCell>]> = [
			['live', 'newest'],
			['failed', 'failed'],
			// A rolled-back failure is resolved, not current, and not reached
			// either — never red, never filled, never the frontier's callout.
			// See the dedicated describe block below.
			['rolled-back', 'behind'],
			['cancelled', 'failed'],
			['deploying', 'deploying'],
			['retrying', 'deploying'],
			['baking', 'checking'],
			['queued', 'behind'],
			['promoting', 'behind'],
			['not-built', 'none']
		];
		for (const [state, expected] of table) {
			expect(nodeStateFromCell(mkCell({ envName: 'dev', state }))).toBe(expected);
		}
	});

	it('stuck overrides every other reading', () => {
		expect(nodeStateFromCell(mkCell({ envName: 'dev', state: 'live', stuck: true }))).toBe('stuck');
		expect(nodeStateFromCell(mkCell({ envName: 'dev', state: 'deploying', stuck: true }))).toBe('stuck');
	});

	it('gated/pinned is held only when isEnvHeld (the whole rollout held) is true', () => {
		expect(nodeStateFromCell(mkCell({ envName: 'staging', state: 'gated', held: true }))).toBe('held');
		expect(nodeStateFromCell(mkCell({ envName: 'staging', state: 'pinned', held: true }))).toBe('held');
		// held: false (a newer candidate could still clear) — reads as an
		// ordinary not-yet-reached wait, never the amber "needs a person" mark.
		expect(nodeStateFromCell(mkCell({ envName: 'staging', state: 'gated', held: false }))).toBe('behind');
	});

	it('waiting-upstream is behind unless isEnvHeld confirms the whole rollout is held', () => {
		expect(nodeStateFromCell(mkCell({ envName: 'staging', state: 'waiting-upstream', held: false }))).toBe('behind');
		expect(nodeStateFromCell(mkCell({ envName: 'staging', state: 'waiting-upstream', held: true }))).toBe('held');
	});
});

describe('a resolved failure is not a current failure, and not reached either (design-rollout fix, round 2)', () => {
	it('rolled-back reads as behind — the same NOT-reached bucket a genuine wait uses, never newest/filled', () => {
		expect(nodeStateFromCell(mkCell({ envName: 'staging', state: 'rolled-back' }))).toBe('behind');
		expect(isReached(nodeStateFromCell(mkCell({ envName: 'staging', state: 'rolled-back' })))).toBe(false);
	});

	it('its label reads "<env> · rolled back to <rev>, resolved"', () => {
		const [stop] = journeyFromCells(
			service([mkCell({ envName: 'staging', state: 'rolled-back', revision: 'a02f1c4' })]),
			{ tiers: TIERS }
		);
		expect(stop.label).toBe('staging · rolled back to a02f1c4, resolved');
		expect(stop.resolved).toBe(true);
	});

	it('a resolved stop is marked `resolved` so the component never draws it filled/reached', () => {
		const [stop] = journeyFromCells(service([mkCell({ envName: 'staging', state: 'rolled-back' })]), {
			tiers: TIERS
		});
		expect(stop.resolved).toBe(true);
		expect(stop.reachedAt).toBeNull();
	});

	it('a resolved stop is never "next" — pickNext skips it for the next genuinely not-yet-reached stop', () => {
		const stops = journeyFromCells(
			service([
				mkCell({ envName: 'dev', state: 'live' }),
				mkCell({ envName: 'staging', state: 'rolled-back' }),
				mkCell({ envName: 'prod-us-east-1', state: 'queued' })
			]),
			{ tiers: TIERS }
		);
		const next = pickNext(stops, TIERS);
		expect(next?.env).toBe('prod-us-east-1');
	});

	it('a resolved stop is never the frontier; an earlier reached stop is, and the solid line ends there', () => {
		const stops = journeyFromCells(
			service([mkCell({ envName: 'dev', state: 'live' }), mkCell({ envName: 'staging', state: 'rolled-back' })]),
			{ tiers: TIERS }
		);
		const frontier = pickFrontier(stops, TIERS);
		expect(frontier?.env).toBe('dev');
		expect(needsCallout(frontier!.state)).toBe(false);
	});

	it('the frontier moves past a resolved stop to a real blocker further on', () => {
		const stops = journeyFromCells(
			service([
				mkCell({ envName: 'dev', state: 'live' }),
				mkCell({ envName: 'staging', state: 'rolled-back' }),
				mkCell({ envName: 'prod-us-east-1', state: 'failed', reason: 'HighErrorRate firing' })
			]),
			{ tiers: TIERS }
		);
		const frontier = pickFrontier(stops, TIERS);
		expect(frontier?.state).toBe('failed');
		expect(frontier?.env).toBe('prod-us-east-1');
	});

	it('when nothing is reached before it, no callout and no frontier at all', () => {
		const stops = journeyFromCells(service([mkCell({ envName: 'dev', state: 'rolled-back' })]), {
			tiers: TIERS
		});
		expect(pickFrontier(stops, TIERS)).toBeNull();
	});
});

describe('red ink only for a LIVE failure — a superseded failed/cancelled cell is also resolved (defensive)', () => {
	it('nodeStateFromCell: a superseded failed cell reads behind, not failed', () => {
		expect(nodeStateFromCell(mkCell({ envName: 'staging', state: 'failed', superseded: true }))).toBe('behind');
		expect(nodeStateFromCell(mkCell({ envName: 'staging', state: 'failed', superseded: false }))).toBe('failed');
	});

	it('nodeStateFromCell: a superseded cancelled cell reads behind too', () => {
		expect(nodeStateFromCell(mkCell({ envName: 'staging', state: 'cancelled', superseded: true }))).toBe('behind');
	});

	it('journeyFromCells marks a superseded failure resolved, with "resolved" in its label, no callout', () => {
		const stops = journeyFromCells(
			service([
				mkCell({ envName: 'dev', state: 'live' }),
				mkCell({ envName: 'staging', state: 'failed', superseded: true, revision: 'a02f1c4' })
			]),
			{ tiers: TIERS }
		);
		const staging = stops.find((s) => s.env === 'staging')!;
		expect(staging.state).toBe('behind');
		expect(staging.resolved).toBe(true);
		expect(staging.label).toBe('staging · failed on a02f1c4, resolved');
		const frontier = pickFrontier(stops, TIERS);
		expect(frontier?.env).toBe('dev');
		expect(needsCallout(frontier!.state)).toBe(false);
	});

	it('a genuinely live (non-superseded) failure stays failed, reached, and needs a callout', () => {
		const stops = journeyFromCells(
			service([mkCell({ envName: 'staging', state: 'failed', superseded: false })]),
			{ tiers: TIERS }
		);
		const staging = stops[0];
		expect(staging.state).toBe('failed');
		expect(staging.resolved).toBeFalsy();
		expect(isReached(staging.state)).toBe(true);
		expect(needsCallout(staging.state)).toBe(true);
	});
});

describe('journeyFromCells', () => {
	it('builds one stop per cell at its tier, mapped by state', () => {
		const stops = journeyFromCells(
			service([
				mkCell({ envName: 'dev', state: 'live', since: '2026-10-10T11:50:00Z' }),
				mkCell({ envName: 'staging', state: 'failed', since: '2026-10-10T11:55:00Z', reason: 'HighErrorRate firing' })
			]),
			{ tiers: TIERS, startAt: '2026-10-10T11:45:00Z' }
		);
		expect(stops.map((s) => s.tier)).toEqual(['dev', 'staging']);
		expect(stops[0].state).toBe('newest');
		expect(stops[1].state).toBe('failed');
		expect(stops[1].reason).toBe('HighErrorRate firing');
	});

	// ⭐ ROUND 4, ITEM 2 — held reasons use `cell.holdCause`
	// (`holdCausePhrase`, blocking-story.ts), the same cause phrase Home and
	// the Overview read, never the vaguer `cell.reason` fallback for the
	// `held` state specifically.
	it('a held stop reads `cell.holdCause` for its reason, not the vaguer `cell.reason`', () => {
		const [held] = journeyFromCells(
			service([
				mkCell({
					envName: 'staging',
					state: 'gated',
					held: true,
					reason: 'held by a rule',
					holdCause: 'waiting on an approval'
				})
			]),
			{ tiers: TIERS }
		);
		expect(held.reason).toBe('waiting on an approval');
	});

	it('a held stop with no `holdCause` falls back to `cell.reason`', () => {
		const [held] = journeyFromCells(
			service([mkCell({ envName: 'staging', state: 'gated', held: true, reason: 'held by a rule' })]),
			{ tiers: TIERS }
		);
		expect(held.reason).toBe('held by a rule');
	});

	it('a non-held stop (e.g. failed) keeps `cell.reason`, never reads `holdCause`', () => {
		const [failed] = journeyFromCells(
			service([
				mkCell({
					envName: 'staging',
					state: 'failed',
					reason: 'HighErrorRate firing',
					holdCause: 'waiting on an approval'
				})
			]),
			{ tiers: TIERS }
		);
		expect(failed.reason).toBe('HighErrorRate firing');
	});

	it('folds several prod cells into one stop, state = worst region, n/N in regions', () => {
		const stops = journeyFromCells(
			service([
				mkCell({ envName: 'prod-us-east-1', state: 'live', since: '2026-10-10T11:58:00Z' }),
				mkCell({ envName: 'prod-eu-west-1', state: 'failed', since: '2026-10-10T11:59:00Z', reason: 'rolled back' })
			]),
			{ tiers: TIERS }
		);
		const prodStop = stops.find((s) => s.tier === 'prod')!;
		expect(prodStop.env).toBe('prod');
		expect(prodStop.state).toBe('failed');
		expect(prodStop.regions).toHaveLength(2);
		expect(prodStop.regions!.filter((r) => r.state === 'newest')).toHaveLength(1);
	});

	it('a skipped tier produces no stop at all', () => {
		const stops = journeyFromCells(service([mkCell({ envName: 'dev', state: 'live' })]), { tiers: TIERS });
		expect(stops.map((s) => s.tier)).toEqual(['dev']);
	});

	it('live everywhere: every tier reached and newest, no stop needs a callout', () => {
		const stops = journeyFromCells(
			service(TIERS.map((t) => mkCell({ envName: t === 'prod' ? 'prod-us-east-1' : t, state: 'live' }))),
			{ tiers: TIERS }
		);
		const frontier = pickFrontier(stops, TIERS);
		expect(frontier?.state).toBe('newest');
		expect(needsCallout(frontier!.state)).toBe(false);
	});

	it('actions: failed -> rollback (button, no href); held by approval -> review; held otherwise -> why-held; deploying -> open', () => {
		const [failed] = journeyFromCells(service([mkCell({ envName: 'dev', state: 'failed' })]), { tiers: TIERS });
		expect(failed.action).toEqual({ kind: 'rollback', label: 'Roll back' });

		const [reviewHeld] = journeyFromCells(
			service([mkCell({ envName: 'staging', state: 'gated', held: true, gateApprovalGuess: true })]),
			{ tiers: TIERS }
		);
		expect(reviewHeld.action?.kind).toBe('review');
		expect(reviewHeld.action?.href).toMatch(/\/gates$/);

		const [whyHeld] = journeyFromCells(
			service([mkCell({ envName: 'staging', state: 'gated', held: true, gateApprovalGuess: false })]),
			{ tiers: TIERS }
		);
		expect(whyHeld.action?.kind).toBe('why-held');

		// ⭐ (lead addendum 5, item 5) — telemetry-indexer's own finding:
		// `gateApprovalGuess` can be false while `holdCause` already reads
		// "is waiting on an approval" (a BlockingStory-level classification
		// broader than the single-gate guess). `actionFor` must read the
		// same evidence `holdCause` itself carries, not the guess alone.
		const [reviewFromHoldCause] = journeyFromCells(
			service([
				mkCell({
					envName: 'staging',
					state: 'gated',
					held: true,
					gateApprovalGuess: false,
					holdCause: 'telemetry-indexer is waiting on an approval'
				})
			]),
			{ tiers: TIERS }
		);
		expect(reviewFromHoldCause.action?.kind).toBe('review');
		expect(reviewFromHoldCause.action?.href).toMatch(/\/gates$/);

		const [deploying] = journeyFromCells(service([mkCell({ envName: 'dev', state: 'deploying' })]), {
			tiers: TIERS
		});
		expect(deploying.action?.kind).toBe('open');
		expect(deploying.action?.href).toBeTruthy();
	});

	it('queued (behind) carries no action', () => {
		const [queued] = journeyFromCells(service([mkCell({ envName: 'dev', state: 'queued' })]), { tiers: TIERS });
		expect(queued.action).toBeUndefined();
	});

	it('buildLabel is set only when the cell revision differs from the journey revision', () => {
		const [same] = journeyFromCells(
			service([mkCell({ envName: 'dev', state: 'live', revision: 'abc123' })]),
			{ tiers: TIERS, revision: 'abc123' }
		);
		expect(same.buildLabel).toBeUndefined();

		const [later] = journeyFromCells(
			service([mkCell({ envName: 'dev', state: 'live', revision: 'def456' })]),
			{ tiers: TIERS, revision: 'abc123' }
		);
		// ⭐ (lead addendum 5, item 3) — prefixed "in <sha>", never a bare sha.
		expect(later.buildLabel).toBe('in def456');
	});

	it('a stop at the "other" tier bucket shows its real env name, never the tier name "other"', () => {
		const [stop] = journeyFromCells(service([mkCell({ envName: 'canary-east', state: 'live' })]), {
			tiers: TIERS
		});
		expect(stop.tier).toBe('other');
		expect(stop.env).toBe('canary-east');
		expect(stop.env).not.toBe('other');
		expect(stop.label).not.toContain('other');
	});
});

describe('journeyFromChange', () => {
	it('aggregates every service at a tier into one stop with counts, worst state leads', () => {
		const services = [
			service([mkCell({ envName: 'prod-us-east-1', state: 'failed', reason: 'rolled back' })]),
			service([mkCell({ envName: 'prod-us-east-1', state: 'gated', held: true })]),
			service([mkCell({ envName: 'prod-us-east-1', state: 'live' })])
		];
		const stops = journeyFromChange(services, {
			tiers: TIERS,
			hrefForTier: (t) => `/changes/acme/widget/pull/1?tier=${t}`
		});
		const prod = stops.find((s) => s.tier === 'prod')!;
		expect(prod.state).toBe('failed');
		expect(prod.counts).toEqual({ total: 3, failed: 1, held: 1, live: 1 });
		expect(prod.href).toBe('/changes/acme/widget/pull/1?tier=prod');
		expect(prod.reason).toContain('rolled back');
	});

	it('names "+N more" when several services share the worst state', () => {
		const services = [
			service([mkCell({ envName: 'staging', state: 'failed', reason: 'HighErrorRate firing' })]),
			service([mkCell({ envName: 'staging', state: 'failed', reason: 'OOMKilled' })])
		];
		const stops = journeyFromChange(services, { tiers: TIERS, hrefForTier: () => '/changes/x' });
		const staging = stops.find((s) => s.tier === 'staging')!;
		expect(staging.reason).toContain('+1 more');
	});

	it('a tier where every service is live reads "3/3 live" in its label', () => {
		const services = [
			service([mkCell({ envName: 'dev', state: 'live' })]),
			service([mkCell({ envName: 'dev', state: 'live' })]),
			service([mkCell({ envName: 'dev', state: 'live' })])
		];
		const stops = journeyFromChange(services, { tiers: TIERS, hrefForTier: () => '/changes/x' });
		expect(stops[0].label).toContain('3/3 live');
	});
});

describe('journeyFromLane', () => {
	const mkRollout = (name: string, namespace: string, version: string, timestamp: string): Rollout =>
		({
			metadata: { name, namespace },
			spec: {},
			status: { history: [{ version: { version }, timestamp, bakeStatus: 'Succeeded' }] }
		}) as unknown as Rollout;
	const mkEnv = (name: string, namespace: string, tier: string): Environment =>
		({
			metadata: { name, namespace },
			spec: { environment: tier, name, rolloutRef: { name } }
		}) as unknown as Environment;

	it('reshapes a Lane into stops with no second state mapping (LaneNode.state carries over)', () => {
		const rollout = mkRollout('hello-world-app', 'hello-world-dev', '1.2.0-9', '2026-10-10T11:00:00Z');
		const env = mkEnv('hello-world-app', 'hello-world-dev', 'dev');
		const cards = buildRolloutCards([rollout], [env], NOW);
		const lanes = buildLanes(cards);
		laneTiers(lanes);
		const stops = journeyFromLane(lanes[0]);
		expect(stops).toHaveLength(1);
		expect(stops[0].tier).toBe('dev');
		expect(stops[0].state).toBe(lanes[0].stages[0].state);
		expect(stops[0].href).toContain('hello-world-dev');
	});
});

describe('time labels', () => {
	it('reachedLabel: "+Nm" with a start, "live Nm" without one', () => {
		expect(reachedLabel('2026-10-10T11:50:00Z', '2026-10-10T11:46:00Z', NOW)).toBe('+4m');
		expect(reachedLabel('2026-10-10T11:50:00Z', null, NOW)).toBe('live 10m');
	});

	it('reachedLabel without a start reads in days past 48h, same threshold as the signed family', () => {
		// 2026-10-08T05:00:00Z is 2d 7h before NOW (2026-10-10T12:00:00Z) — 55h,
		// past the 48h threshold both the "+Nm" and bare families now share.
		expect(reachedLabel('2026-10-08T05:00:00Z', null, NOW)).toBe('live 2d');
	});

	it('frontierLabel: a duration, "waiting" prefix only when held', () => {
		expect(frontierLabel('deploying', '2026-10-10T11:54:00Z', NOW)).toBe('6m');
		expect(frontierLabel('held', '2026-10-10T09:00:00Z', NOW)).toBe('waiting 3h');
	});

	it('frontierLabel reads in days past 48h too — one threshold shared with reachedLabel/queuedLabel', () => {
		expect(frontierLabel('held', '2026-10-08T05:00:00Z', NOW)).toBe('waiting 2d');
	});

	it('queuedLabel: "queued <duration>", same bare-duration family, "" with no since', () => {
		expect(queuedLabel('2026-10-10T11:54:00Z', NOW)).toBe('queued 6m');
		expect(queuedLabel('2026-09-24T12:00:00Z', NOW)).toBe('queued 16d');
		expect(queuedLabel(null, NOW)).toBe('');
	});

	it('roughLabel: minutes under an hour, hours above', () => {
		expect(roughLabel(5 * 60000)).toBe('~5m');
		expect(roughLabel(90 * 60000)).toBe('~2h');
	});
});

describe('journey labels: days past 48h, held cause on a whole change', () => {
	it('a span past two days reads in days', async () => {
		const { plusDurationLabel } = await import('./journey');
		expect(plusDurationLabel(391 * 3600_000 + 33 * 60_000)).toBe('+16d');
		expect(plusDurationLabel(47 * 3600_000)).toBe('+47h');
	});
});

describe('journeyFromChange: a held stop says the shared cause', () => {
	it('reads cell.holdCause, not cell.reason', () => {
		const services = [
			service([mkCell({ envName: 'prod', state: 'gated', held: true, reason: 'waiting on a rule', holdCause: 'waiting on an approval' })])
		];
		const stops = journeyFromChange(services, { tiers: TIERS, hrefForTier: () => '/changes/x' });
		const prod = stops.find((s) => s.tier === 'prod')!;
		expect(prod.state).toBe('held');
		expect(prod.reason).toBe('waiting on an approval');
	});
});

describe('pickNext: never before the frontier (B-1 fix)', () => {
	it('an earlier not-reached stop is never "next" when a LATER tier is already reached', () => {
		// Unusual but possible input shape: staging not reached (behind) while
		// prod (later in tier order) already shows reached. The frontier is
		// the FURTHEST reached stop (prod), so staging sits BEHIND it, not
		// ahead of it, and must never carry the "next" label.
		const stops: JourneyStop[] = [
			{ key: 'staging', tier: 'staging', env: 'staging', state: 'behind', href: '/x' },
			{ key: 'prod', tier: 'prod', env: 'prod', state: 'newest', href: '/y' }
		];
		expect(pickFrontier(stops, TIERS)?.env).toBe('prod');
		expect(pickNext(stops, TIERS)).toBeNull();
	});

	it('still returns the first not-reached stop AFTER the frontier in the ordinary forward case', () => {
		const stops = journeyFromCells(
			service([
				mkCell({ envName: 'dev', state: 'live' }),
				mkCell({ envName: 'staging', state: 'queued' }),
				mkCell({ envName: 'prod-us-east-1', state: 'queued' })
			]),
			{ tiers: TIERS }
		);
		expect(pickNext(stops, TIERS)?.env).toBe('staging');
	});

	it('with no frontier at all (nothing reached), "next" is still the first not-reached stop', () => {
		const stops = journeyFromCells(service([mkCell({ envName: 'dev', state: 'queued' })]), { tiers: TIERS });
		expect(pickFrontier(stops, TIERS)).toBeNull();
		expect(pickNext(stops, TIERS)?.env).toBe('dev');
	});
});

describe('a held stage is drawn held everywhere, not only at the frontier (B-2)', () => {
	it('an earlier held stop stays held even once a later stop is reached', () => {
		const stops = journeyFromCells(
			service([
				mkCell({ envName: 'staging', state: 'gated', held: true, since: '2026-10-10T09:00:00Z' }),
				mkCell({ envName: 'prod-us-east-1', state: 'live' })
			]),
			{ tiers: TIERS }
		);
		const staging = stops.find((s) => s.env === 'staging')!;
		expect(staging.state).toBe('held');
		// isReached counts held as reached, by design — this is NOT the
		// frontier (prod is), but the adapter still marks it held so the
		// component's own held-everywhere styling applies.
		expect(isReached(staging.state)).toBe(true);
	});
});

describe('frontierStateWord / journeyFrontier (B-4, the one frontier)', () => {
	it('names every state word the callout uses, and "Live" once nothing needs a person', () => {
		expect(frontierStateWord('failed')).toBe('Failed');
		expect(frontierStateWord('stuck')).toBe('Stuck');
		expect(frontierStateWord('held')).toBe('Held');
		expect(frontierStateWord('checking')).toBe('Checking');
		expect(frontierStateWord('deploying')).toBe('Deploying');
		expect(frontierStateWord('newest')).toBe('Live');
	});

	it('journeyFrontier reports the frontier stop, its env as `place`, and a matching stateWord', () => {
		const stops = journeyFromCells(
			service([
				mkCell({ envName: 'dev', state: 'live' }),
				mkCell({ envName: 'staging', state: 'gated', held: true, since: '2026-10-10T10:00:00Z' })
			]),
			{ tiers: TIERS }
		);
		const info = journeyFrontier(stops, TIERS);
		expect(info?.place).toBe('staging');
		expect(info?.stateWord).toBe('Held');
		expect(info?.since).toBe('2026-10-10T10:00:00Z');
	});

	it('is null when nothing has been reached yet', () => {
		const stops = journeyFromCells(service([mkCell({ envName: 'dev', state: 'queued' })]), { tiers: TIERS });
		expect(journeyFrontier(stops, TIERS)).toBeNull();
	});
});
