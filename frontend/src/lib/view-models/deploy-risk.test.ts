import { describe, it, expect } from 'vitest';
import {
	confirmLevel,
	confirmNotice,
	deployActionLabel,
	deployDirection,
	deployIntent,
	gatesAllow,
	isProductionTarget,
	rollbackTarget,
	rolloutEnvironmentName,
	targetPhrase,
	typedPrompt
} from './deploy-risk';
import type { Rollout } from '../../types';

/**
 * THE FIXTURE IS THE LIVE HUB'S OWN SHAPE, 2026-08-31.
 *
 * `hello-world-prod/hello-world-app`: three gates — a deployment gate passing
 * with a 15-entry allow-list, a manual-approval gate passing with an EMPTY
 * allow-list, and a schedule gate NOT passing. That is the exact state the
 * critic force-deployed through in two clicks with no confirmation.
 */
const NEWEST = 'main-1785344304-9f10e494';
const MID = 'main-1785342693-3cc206ce';
const RUNNING = 'main-1784663161-205a3129';
const OLDEST = 'main-1784664084-1d5defa0';

function rollout(over: Record<string, unknown> = {}): Rollout {
	return {
		metadata: {
			name: 'hello-world-app',
			namespace: 'hello-world-prod',
			labels: { environment: 'prod' }
		},
		spec: {},
		status: {
			// oldest-first, exactly as the API publishes it
			availableReleases: [
				{ tag: OLDEST, version: '1d5defa' },
				{ tag: RUNNING, version: '205a312' },
				{ tag: MID, version: '3cc206c' },
				{ tag: NEWEST, version: '9f10e49' }
			],
			gates: [
				{ name: 'ghd-cmppc', passing: true, allowedVersions: [NEWEST, MID] },
				{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] },
				{ name: 'schedule-gate-q25wv', passing: false, allowedVersions: null }
			],
			history: [{ version: { tag: RUNNING, version: '205a312' }, bakeStatus: 'Succeeded' }]
		},
		...over
	} as unknown as Rollout;
}

/** Same app, dev namespace, all gates open. */
function devRollout(over: Record<string, unknown> = {}): Rollout {
	const r = rollout(over) as unknown as Record<string, any>;
	r.metadata = { ...r.metadata, namespace: 'hello-world-dev', labels: { environment: 'dev' } };
	r.status = {
		...r.status,
		gates: [{ name: 'ghd-cmppc', passing: true, allowedVersions: [NEWEST, MID] }]
	};
	return r as unknown as Rollout;
}

describe('environment classification', () => {
	it('reads the environment label first', () => {
		expect(rolloutEnvironmentName(rollout())).toBe('prod');
	});

	it('an explicit name from the Environment object wins', () => {
		expect(rolloutEnvironmentName(rollout(), 'production-eu')).toBe('production-eu');
	});

	it('falls back to the namespace when nothing else names the environment', () => {
		const r = { metadata: { namespace: 'hello-world-prod' } } as unknown as Rollout;
		expect(rolloutEnvironmentName(r)).toBe('hello-world-prod');
		expect(isProductionTarget(rolloutEnvironmentName(r))).toBe(true);
	});

	it('the namespace fallback errs toward production, never away from it', () => {
		// A false positive costs a sentence; a false negative costs an unvetted
		// production deploy with no pause.
		expect(isProductionTarget('checkout-production-canary')).toBe(true);
		expect(isProductionTarget('dev')).toBe(false);
		expect(isProductionTarget('staging')).toBe(false);
		expect(isProductionTarget('')).toBe(false);
	});
});

describe('gatesAllow — would the controller have shipped this on its own?', () => {
	it('is false when any gate is not passing', () => {
		expect(gatesAllow(rollout(), NEWEST)).toBe(false);
	});

	it('is false for a passing gate with an empty allow-list', () => {
		const r = rollout({
			status: {
				...(rollout().status as object),
				gates: [{ name: 'approval', passing: true, allowedVersions: [] }]
			}
		});
		expect(gatesAllow(r, NEWEST)).toBe(false);
	});

	it('is true when every gate passes and every allow-list contains the build', () => {
		expect(gatesAllow(devRollout(), NEWEST)).toBe(true);
	});

	it('is false when one gate allows it and another does not list it', () => {
		expect(gatesAllow(devRollout(), OLDEST)).toBe(false);
	});

	it('is true when the rollout publishes no gates at all', () => {
		const r = rollout({ status: { ...(rollout().status as object), gates: [] } });
		expect(gatesAllow(r, NEWEST)).toBe(true);
	});

	it('is false for no selection', () => {
		expect(gatesAllow(rollout(), null)).toBe(false);
	});
});

describe('deployDirection', () => {
	it('newer in the rollouts own list is forward', () => {
		expect(deployDirection(rollout(), NEWEST)).toBe('forward');
	});
	it('older in the rollouts own list is rollback', () => {
		expect(deployDirection(rollout(), OLDEST)).toBe('rollback');
	});
	it('the running version is same', () => {
		expect(deployDirection(rollout(), RUNNING)).toBe('same');
	});
	it('an unlisted tag cannot be proven backwards, so it is forward', () => {
		expect(deployDirection(rollout(), 'some-tag-nobody-released')).toBe('forward');
	});
});

describe('confirmLevel — THE SAFETY RULE', () => {
	it('⛔ forward into PRODUCTION past gates that refuse it demands a typed sha', () => {
		// The exact event: two clicks, three closed gates, no confirmation.
		const intent = deployIntent(rollout(), NEWEST);
		expect(intent).toMatchObject({ direction: 'forward', production: true, vouched: false });
		expect(confirmLevel(intent)).toBe('typed');
	});

	it('forward into production that every gate already allows gets a notice, not a typing test', () => {
		const r = rollout({
			status: {
				...(rollout().status as object),
				gates: [{ name: 'ghd', passing: true, allowedVersions: [NEWEST] }]
			}
		});
		const intent = deployIntent(r, NEWEST);
		expect(intent).toMatchObject({ production: true, vouched: true });
		expect(confirmLevel(intent)).toBe('notice');
	});

	it('forward into a non-production environment past its gates gets a notice', () => {
		const intent = deployIntent(devRollout(), OLDEST);
		expect(intent).toMatchObject({ production: false, vouched: false, direction: 'rollback' });
		// (OLDEST is backwards here; use a forward unvouched case explicitly)
		const closedDev = devRollout() as unknown as Record<string, any>;
		closedDev.status = {
			...closedDev.status,
			gates: [{ name: 'ghd', passing: true, allowedVersions: [] }]
		};
		const fwd = deployIntent(closedDev as unknown as Rollout, NEWEST);
		expect(fwd).toMatchObject({ production: false, vouched: false, direction: 'forward' });
		expect(confirmLevel(fwd)).toBe('notice');
	});

	it('the ordinary forward deploy — vouched, not production — asks for nothing', () => {
		const intent = deployIntent(devRollout(), NEWEST);
		expect(confirmLevel(intent)).toBe('none');
	});

	it('⛔ a ROLLBACK never reaches typed, not even in production', () => {
		const intent = deployIntent(rollout(), OLDEST);
		expect(intent.direction).toBe('rollback');
		expect(intent.production).toBe(true);
		expect(confirmLevel(intent)).toBe('notice');
	});

	it('a custom tag nothing has vouched for still demands a typed sha', () => {
		const intent = deployIntent(devRollout(), 'main-9999-deadbeef');
		expect(intent.custom).toBe(true);
		expect(confirmLevel(intent)).toBe('typed');
	});

	it('re-deploying the running version asks for nothing', () => {
		expect(confirmLevel(deployIntent(rollout(), RUNNING))).toBe('none');
	});

	it('the direction of travel is what moved: forward-to-prod is stricter than back-from-prod', () => {
		const forward = confirmLevel(deployIntent(rollout(), NEWEST));
		const back = confirmLevel(deployIntent(rollout(), OLDEST));
		const order: Record<string, number> = { none: 0, notice: 1, typed: 2 };
		expect(order[forward]).toBeGreaterThan(order[back]);
	});
});

describe('copy', () => {
	it('names production in the notice and on the button', () => {
		const intent = deployIntent(rollout(), NEWEST);
		expect(confirmNotice(intent)).toContain('production');
		expect(deployActionLabel(intent)).toBe('Deploy to production');
		expect(typedPrompt(intent)).toContain('production');
	});

	it('names the environment the cluster names when it is not production', () => {
		const intent = deployIntent(devRollout(), NEWEST);
		expect(targetPhrase(intent)).toBe('dev');
		expect(deployActionLabel(intent)).toBe('Deploy to dev');
	});

	it('a rollback button says roll back, and the notice says it pins', () => {
		const intent = deployIntent(rollout(), OLDEST);
		expect(deployActionLabel(intent)).toBe('Roll back production');
		expect(confirmNotice(intent, true)).toContain('pins production');
	});

	it('says nothing at all when the level is none', () => {
		expect(confirmNotice(deployIntent(devRollout(), NEWEST))).toBeNull();
	});
});

describe('rollbackTarget — the button must mean backwards', () => {
	it('⛔ never pre-selects a NEWER previously-deployed version', () => {
		// The reported defect: current is an older build (it was itself rolled
		// back to), so `history[1]` is NEWER and "Rollback" opened a roll-forward.
		const r = rollout({
			status: {
				...(rollout().status as object),
				history: [
					{ version: { tag: RUNNING, version: '205a312' } },
					{ version: { tag: NEWEST, version: '9f10e49' } },
					{ version: { tag: OLDEST, version: '1d5defa' } }
				]
			}
		});
		expect(rollbackTarget(r)).toMatchObject({ tag: OLDEST, basis: 'ran-here' });
	});

	it('prefers the most recent older version this environment has actually run', () => {
		const r = rollout({
			status: {
				...(rollout().status as object),
				history: [
					{ version: { tag: NEWEST } },
					{ version: { tag: MID } },
					{ version: { tag: OLDEST } }
				]
			}
		});
		expect(rollbackTarget(r)).toMatchObject({ tag: MID, basis: 'ran-here' });
	});

	it('falls back to the release directly below when nothing older ever ran here', () => {
		const r = rollout({
			status: {
				...(rollout().status as object),
				history: [{ version: { tag: MID } }, { version: { tag: NEWEST } }]
			}
		});
		expect(rollbackTarget(r)).toMatchObject({ tag: RUNNING, basis: 'older-release' });
	});

	it('orders by build creation time when the running version is not in the release list', () => {
		const r = rollout({
			status: {
				...(rollout().status as object),
				history: [
					{ version: { tag: 'custom-build', created: '2026-07-29T16:00:00Z' } },
					{ version: { tag: 'older-custom', created: '2026-07-28T10:00:00Z' } }
				]
			}
		});
		expect(rollbackTarget(r)).toMatchObject({ tag: 'older-custom', basis: 'ran-here' });
	});

	it('⛔ returns null when there is nothing older — the caller must not offer the button', () => {
		const r = rollout({
			status: {
				...(rollout().status as object),
				history: [{ version: { tag: OLDEST } }, { version: { tag: NEWEST } }]
			}
		});
		expect(rollbackTarget(r)).toBeNull();
	});

	it('returns null for a rollout that has never deployed', () => {
		expect(rollbackTarget({ status: {} } as unknown as Rollout)).toBeNull();
		expect(rollbackTarget(null)).toBeNull();
	});

	it('the target it picks classifies as a rollback', () => {
		const r = rollout();
		const t = rollbackTarget(r)!;
		expect(deployDirection(r, t.tag)).toBe('rollback');
	});
});
