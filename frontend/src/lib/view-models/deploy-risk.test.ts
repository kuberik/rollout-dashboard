import { describe, it, expect } from 'vitest';
import {
	confirmLevel,
	confirmNotice,
	deployActionLabel,
	deployDirection,
	deployIntent,
	failedHereVerdict,
	gatesAllow,
	isProductionTarget,
	rollbackTarget,
	rolloutEnvironmentName,
	rowShowsFailed,
	retryConsequences,
	retryIntent,
	retryTag,
	splitLeadSentence,
	targetPhrase,
	typedPrompt
} from './deploy-risk';
import { blockingGateNames } from './promotion';
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

	it('is true for a passing gate that publishes no allow-list (a schedule gate) — it vouches by passing', () => {
		// hello-multi-dev, live 2026-09-05: `ghd-5h4bw passing, allowedVersions: null`.
		const r = rollout({
			status: {
				...(rollout().status as object),
				gates: [{ name: 'ghd-5h4bw', passing: true, allowedVersions: null }]
			}
		});
		expect(gatesAllow(r, NEWEST)).toBe(true);
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

	it('⛔ SUPERSEDED 2026-09-03 (B3): forward into production is `typed` now even when every gate already allows it', () => {
		// This used to be `notice` — "every rule allows it, so this is the move
		// the controller would make on its own". A live walk found the ceremony
		// gap was on the OTHER side (a rollback into production skipped typing
		// entirely), and closing it meant PRODUCTION itself earns the pause in
		// either direction, not just the unvouched half of it. See
		// `confirmLevel`'s own doc comment for the full account.
		const r = rollout({
			status: {
				...(rollout().status as object),
				gates: [{ name: 'ghd', passing: true, allowedVersions: [NEWEST] }]
			}
		});
		const intent = deployIntent(r, NEWEST);
		expect(intent).toMatchObject({ production: true, vouched: true });
		expect(confirmLevel(intent)).toBe('typed');
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

	it('⛔ SUPERSEDED 2026-09-03 (B3): a rollback into production now reaches typed too', () => {
		// Renamed from "a ROLLBACK never reaches typed, not even in
		// production" — that title was the bug report. A live walk rolled
		// back `hello-world-prod/hello-world-app` in two taps with no typed
		// confirmation, a blue (non-alarm) primary, and a disabled toggle
		// that read as off while it silently pinned production. The general
		// argument survives for NON-production rollbacks — see the test
		// below — but production itself is `typed` in either direction now.
		const intent = deployIntent(rollout(), OLDEST);
		expect(intent.direction).toBe('rollback');
		expect(intent.production).toBe(true);
		expect(confirmLevel(intent)).toBe('typed');
	});

	it('a rollback OUT of production keeps the soft `notice` path — the fast 3am recovery', () => {
		const intent = deployIntent(devRollout(), OLDEST);
		expect(intent.direction).toBe('rollback');
		expect(intent.production).toBe(false);
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

	it('⛔ SUPERSEDED 2026-09-03 (B3): production is a CEILING now, not a direction-dependent step', () => {
		// This used to assert forward-to-prod strictly stricter than
		// back-from-prod — true under the old table, where a rollback got a
		// free pass on the one tier a mistake costs the most. Both directions
		// land on `typed` in production now; direction still matters, but
		// only OUTSIDE production, where a rollback keeps its softer
		// `notice` and a vouched forward deploy stays a free `none`.
		const order: Record<string, number> = { none: 0, notice: 1, typed: 2 };
		const prodForward = confirmLevel(deployIntent(rollout(), NEWEST));
		const prodBack = confirmLevel(deployIntent(rollout(), OLDEST));
		expect(prodForward).toBe('typed');
		expect(prodBack).toBe('typed');

		const devForward = confirmLevel(deployIntent(devRollout(), MID));
		const devBack = confirmLevel(deployIntent(devRollout(), OLDEST));
		expect(order[devBack]).toBeGreaterThan(order[devForward]);
	});
});

describe('copy', () => {
	// ⭐ ROUND 5 (squad-fleet, SPEC ruling "one place name… never
	// 'production'") — `targetPhrase` now prints the environment's real
	// name always ("prod"), never the generic word "production", so every
	// sentence built on it reads the same place name the row/map/header
	// that opened this dialog already used.
	it('names prod (the real place name, never "production") in the notice and on the button', () => {
		const intent = deployIntent(rollout(), NEWEST);
		expect(confirmNotice(intent)).toContain('prod');
		expect(confirmNotice(intent)).not.toContain('production');
		expect(deployActionLabel(intent)).toBe('Deploy to prod');
		expect(typedPrompt(intent)).toContain('prod');
		expect(typedPrompt(intent)).not.toContain('production');
	});

	it('names the environment the cluster names when it is not production', () => {
		const intent = deployIntent(devRollout(), NEWEST);
		expect(targetPhrase(intent)).toBe('dev');
		expect(deployActionLabel(intent)).toBe('Deploy to dev');
	});

	it('a rollback button says roll back, and the notice says it pins', () => {
		const intent = deployIntent(rollout(), OLDEST);
		// U-11, ledger: the confirm button is bare `Roll back` now — the
		// dialog's own TITLE carries the target ("Roll back prod to
		// <build>"), so the button does not repeat it.
		expect(deployActionLabel(intent)).toBe('Roll back');
		expect(confirmNotice(intent, true)).toContain('pins prod');
	});

	it('says nothing at all when the level is none', () => {
		expect(confirmNotice(deployIntent(devRollout(), NEWEST))).toBeNull();
	});
});

describe('splitLeadSentence — the consequence is bold, the rest is not', () => {
	it('splits the first sentence from the rest', () => {
		const notice = confirmNotice(deployIntent(rollout(), NEWEST))!;
		const { lead, rest } = splitLeadSentence(notice);
		expect(notice.startsWith(lead)).toBe(true);
		expect(lead).toMatch(/[.!?]$/);
		expect(`${lead} ${rest}`.trim()).toBe(notice);
	});

	it('a single sentence has an empty rest', () => {
		expect(splitLeadSentence('Only one sentence here.')).toEqual({
			lead: 'Only one sentence here.',
			rest: ''
		});
	});

	it('a string with no terminal punctuation is the whole lead', () => {
		expect(splitLeadSentence('no punctuation')).toEqual({ lead: 'no punctuation', rest: '' });
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

// ── ⚠️ THE RETRY ────────────────────────────────────────────────────────────
// `Retry` in the red failure banner was ONE CLICK, UNCONFIRMED, straight into
// production — at the same second that sending that identical build through
// `Change Version` demanded a typed sha. These tests pin what the EXISTING rule
// returns for a retry; no second rule was written.

/** Dev, and every gate allows the build that is actually running. */
function devRolloutVouched(): Rollout {
	const r = devRollout() as unknown as Record<string, any>;
	r.status = {
		...r.status,
		gates: [{ name: 'ghd-cmppc', passing: true, allowedVersions: [NEWEST, MID, RUNNING] }]
	};
	return r as unknown as Rollout;
}

describe('⚠️ retry risk — the rule decides, and it is the SAME rule', () => {
	it('a retry sends the build at the head of history, not a picked version', () => {
		expect(retryTag(rollout())).toBe(RUNNING);
		expect(retryIntent(rollout()).direction).toBe('retry');
		expect(retryIntent(rollout()).custom).toBe(false);
	});

	it('⭐ THE LIVE CASE: retrying a failed production deploy is `typed`', () => {
		// prod + the gates do not allow the running build (the schedule gate is
		// not passing) → the same row `forward` uses for an unvouched production
		// deploy. At least as dangerous as the manual deploy that demands typing,
		// and now priced the same.
		const intent = retryIntent(rollout());
		expect(intent.production).toBe(true);
		expect(intent.vouched).toBe(false);
		expect(confirmLevel(intent)).toBe('typed');
		expect(deployActionLabel(intent)).toBe('Redeploy to prod');
		expect(typedPrompt(intent)).toBe('Nothing has vouched for this build in prod. Type');
	});

	it('⛔ SUPERSEDED 2026-09-03 (B3): a vouched retry in production is `typed` too now', () => {
		// Was `notice` — "every rule allows it, so this is the move the
		// controller would make on its own". Production is a ceiling now
		// regardless of vouching or direction (see `confirmLevel`'s own doc
		// comment); a retry that lands production traffic is not exempt just
		// because it resends a build already running.
		const r = rollout() as unknown as Record<string, any>;
		r.status = {
			...r.status,
			gates: [{ name: 'ghd-cmppc', passing: true, allowedVersions: [RUNNING] }]
		};
		const intent = retryIntent(r as unknown as Rollout);
		expect(confirmLevel(intent)).toBe('typed');
	});

	it('⭐ retrying a transient failure in dev STAYS ONE CLICK', () => {
		// `none` means the caller fires immediately and never opens a dialog.
		// Friction that fires on every action stops being read.
		const intent = retryIntent(devRolloutVouched());
		expect(intent.production).toBe(false);
		expect(intent.vouched).toBe(true);
		expect(confirmLevel(intent)).toBe('none');
		expect(retryConsequences(intent, { failingChecks: [], clearsFailureDetail: false })).toEqual([]);
	});

	it('dev with the rules refusing the build is a notice — a sentence, not a barrier', () => {
		expect(confirmLevel(retryIntent(devRollout()))).toBe('notice');
	});

	it('⛔ `retry` never reaches the `same` short-circuit that used to wave it through', () => {
		// The build a retry sends IS the running build, so `deployDirection`
		// calls it `same` and `confirmLevel` returns `none`. That is right for
		// `Change Version` and was the whole defect for `Retry`.
		expect(deployDirection(rollout(), RUNNING)).toBe('same');
		expect(confirmLevel(deployIntent(rollout(), RUNNING))).toBe('none');
		expect(confirmLevel(retryIntent(rollout()))).toBe('typed');
	});

	it('`deployDirection` never invents a retry — only `retryIntent` sets it', () => {
		for (const tag of [NEWEST, MID, RUNNING, OLDEST, null, 'not-a-tag']) {
			expect(deployDirection(rollout(), tag)).not.toBe('retry');
		}
	});
});

describe('⚠️ retry consequences — it says production, and it says what it destroys', () => {
	const facts = {
		failingChecks: ['Checkout p99 latency'],
		clearsFailureDetail: true
	};

	it('names the build, the destination, the still-failing check, and the erasure', () => {
		const lines = retryConsequences(retryIntent(rollout()), facts, RUNNING);
		expect(lines).toHaveLength(4);
		expect(lines[0]).toContain(RUNNING);
		expect(lines[0]).toContain('prod');
		expect(lines[0]).toContain('the same build whose last deploy here failed');
		expect(lines[1]).toContain('A rule here is still holding this build back');
		// The critique's exact charge: no statement that the check which just
		// failed is still failing.
		expect(lines[2]).toBe(
			'Checkout p99 latency is still failing right now. Nothing has re-checked this build since.'
		);
		// And the consequence nobody was told about: the controller resets the
		// check on retry and deletes the message and `lastErrorTime` with it.
		expect(lines[3]).toContain('Pending — reset due to new deployment');
		expect(lines[3]).toContain('clears the failure detail');
	});

	it('every line names the real place (prod) somewhere a reader will hit it', () => {
		const lines = retryConsequences(retryIntent(rollout()), facts, RUNNING);
		expect(lines.join(' ')).toContain('prod');
	});

	it('claims no erasure when there is no health check to erase', () => {
		const lines = retryConsequences(
			retryIntent(rollout()),
			{ failingChecks: [], clearsFailureDetail: false },
			RUNNING
		);
		expect(lines.join(' ')).not.toContain('reset due to new deployment');
		expect(lines.join(' ')).not.toContain('still failing');
	});

	it('⭐ a RECOVERED check gets the erasure warning but never "still failing"', () => {
		// Verified live: the check recovered, `history[0].failedHealthChecks`
		// kept the entry, and `lastErrorTime` survived — the witness the rest of
		// the product reads "recovered" from. A retry deletes it.
		const lines = retryConsequences(
			retryIntent(rollout()),
			{ failingChecks: [], clearsFailureDetail: true },
			RUNNING
		);
		expect(lines.join(' ')).not.toContain('still failing');
		expect(lines[lines.length - 1]).toContain(
			'erases the record that anything failed here'
		);
	});

	it('counts and samples when several checks are failing', () => {
		const lines = retryConsequences(
			retryIntent(rollout()),
			{ failingChecks: ['a', 'b', 'c', 'd'], clearsFailureDetail: true },
			RUNNING
		);
		expect(lines[2]).toContain('4 health checks are still failing');
		expect(lines[2]).toContain('a, b, c, …');
		expect(lines[3]).toContain('resets those checks');
	});

	it('says nothing at all when the rule says one click', () => {
		expect(retryConsequences(retryIntent(devRolloutVouched()), facts, RUNNING)).toEqual([]);
	});
});

/**
 * U-4, ledger, 2026-10-08 — TL ruling, coordinator decision: a build whose
 * last attempt on THIS rollout failed must never be offered as `Ready` with
 * a plain `Deploy`, derived from `rollout.status.history` alone, no
 * mock-only flag. The three cases the TL named explicitly.
 */
describe('failedHereVerdict (U-4, ledger)', () => {
	const FAILED_BUILD = 'main-1784664084-a02f1c4';
	const CURRENT_BUILD = 'main-1784664999-3f1ed09';
	const NEVER_DEPLOYED = 'main-1784665555-b46rc1';

	it('failed, then rolled back — `failed`, with the failure time and the rollback time', () => {
		const r = rollout({
			status: {
				availableReleases: [
					{ tag: CURRENT_BUILD, version: '3f1ed09' },
					{ tag: FAILED_BUILD, version: 'a02f1c4' }
				],
				history: [
					// newest first: the rollback deploy, then the failed attempt
					// it replaced, then what was running before that.
					{
						version: { tag: CURRENT_BUILD, version: '3f1ed09' },
						bakeStatus: 'Succeeded',
						timestamp: '2026-10-08T09:00:00Z'
					},
					{
						version: { tag: FAILED_BUILD, version: 'a02f1c4' },
						bakeStatus: 'Failed',
						timestamp: '2026-10-08T08:52:00Z'
					},
					{
						version: { tag: CURRENT_BUILD, version: '3f1ed09' },
						bakeStatus: 'Succeeded',
						timestamp: '2026-10-08T08:00:00Z'
					}
				]
			}
		});
		const v = failedHereVerdict(r, FAILED_BUILD);
		expect(v.kind).toBe('failed');
		if (v.kind === 'failed') {
			expect(v.failedAt).toBe('2026-10-08T08:52:00Z');
			// the deploy that REPLACED the failed attempt — i.e. when it was
			// rolled back — is the entry one step newer than it.
			expect(v.rolledBackAt).toBe('2026-10-08T09:00:00Z');
		}
	});

	it('failed, still running (nothing has replaced it yet) — `failed`, no rollback time', () => {
		const r = rollout({
			status: {
				history: [
					{
						version: { tag: FAILED_BUILD, version: 'a02f1c4' },
						bakeStatus: 'Failed',
						timestamp: '2026-10-08T08:52:00Z'
					},
					{
						version: { tag: CURRENT_BUILD, version: '3f1ed09' },
						bakeStatus: 'Succeeded',
						timestamp: '2026-10-08T08:00:00Z'
					}
				]
			}
		});
		const v = failedHereVerdict(r, FAILED_BUILD);
		expect(v.kind).toBe('failed');
		if (v.kind === 'failed') expect(v.rolledBackAt).toBeNull();
	});

	it('failed, then a LATER retry of the same build succeeded — `clean`, it is fine again', () => {
		const r = rollout({
			status: {
				history: [
					// newest first: the retry that succeeded is closer to the
					// front than the original failure.
					{
						version: { tag: FAILED_BUILD, version: 'a02f1c4' },
						bakeStatus: 'Succeeded',
						timestamp: '2026-10-08T09:10:00Z'
					},
					{
						version: { tag: FAILED_BUILD, version: 'a02f1c4' },
						bakeStatus: 'Failed',
						timestamp: '2026-10-08T08:52:00Z'
					}
				]
			}
		});
		expect(failedHereVerdict(r, FAILED_BUILD)).toEqual({ kind: 'clean' });
	});

	it('never deployed here — `clean`', () => {
		expect(failedHereVerdict(rollout(), NEVER_DEPLOYED)).toEqual({ kind: 'clean' });
	});

	it('no tag, or no rollout — `clean`', () => {
		expect(failedHereVerdict(rollout(), null)).toEqual({ kind: 'clean' });
		expect(failedHereVerdict(null, FAILED_BUILD)).toEqual({ kind: 'clean' });
	});

	it('deployIntent sets knownFailedHere from the SAME derivation', () => {
		const r = rollout({
			status: {
				history: [
					{
						version: { tag: FAILED_BUILD, version: 'a02f1c4' },
						bakeStatus: 'Failed',
						timestamp: '2026-10-08T08:52:00Z'
					}
				]
			}
		});
		expect(deployIntent(r, FAILED_BUILD).knownFailedHere).toBe(true);
		expect(deployIntent(r, CURRENT_BUILD).knownFailedHere).toBe(false);
	});

	it('a known-failed build is `typed` even in a non-production, otherwise-vouched environment', () => {
		// `devRollout`'s own default gate vouches for `MID`/`NEWEST` — used
		// here as the "failed build" tag so `vouched` is genuinely true and
		// the only thing making this `typed` is `knownFailedHere`.
		const r = devRollout({
			status: {
				history: [
					// `RUNNING` is what's live now; `MID` is the forward
					// candidate under test, offered again after its own
					// earlier attempt failed.
					{ version: { tag: RUNNING, version: '205a312' }, bakeStatus: 'Succeeded' },
					{
						version: { tag: MID, version: '3cc206c' },
						bakeStatus: 'Failed',
						timestamp: '2026-10-08T08:52:00Z'
					}
				]
			}
		});
		const intent = deployIntent(r, MID);
		expect(intent.production).toBe(false);
		expect(intent.vouched).toBe(true);
		expect(confirmLevel(intent)).toBe('typed');
		expect(deployActionLabel(intent)).toBe('Deploy anyway');
		expect(typedPrompt(intent)).toBe('This build already failed here. Type');
	});

	it('a retry never becomes `typed` through this signal — `knownFailedHere` is deliberately false for retry', () => {
		// `retryTag` is `history[0]`, which is `Failed` on essentially every
		// ordinary retry; `retryIntent` must not run that through
		// `failedHereVerdict`, or one click in dev would stop being one click.
		const r = devRollout({
			status: {
				history: [{ version: { tag: RUNNING, version: '205a312' }, bakeStatus: 'Failed' }]
			}
		});
		const intent = retryIntent(r);
		expect(intent.knownFailedHere).toBe(false);
	});
});

/**
 * ⭐ U-9, 2026-10-08 (QA): FAILED TAKES THE ROW, EVEN WHILE A GATE ALSO HOLDS
 * THE SAME BUILD. Before this fix, rollout detail's inline `justFailed =
 * !isBlocked && failedHere.kind === 'failed'` silently flipped to `false`
 * the moment a gate ALSO held the candidate — the exact scenario this suite
 * exercises, combining `rowShowsFailed` with `blockingGateNames` (the U-5
 * fix, `promotion.ts`) on one fixture where both facts are true at once.
 */
describe('rowShowsFailed — U-9, FAILED outranks a gate hold on the same row', () => {
	const FAILED_BUILD = 'main-1784664084-a02f1c4';
	const CURRENT_BUILD = 'main-1784664999-3f1ed09';

	function failedAndHeldRollout(): Rollout {
		return rollout({
			status: {
				availableReleases: [
					{ tag: CURRENT_BUILD, version: '3f1ed09' },
					{ tag: FAILED_BUILD, version: 'a02f1c4' }
				],
				history: [
					{
						version: { tag: CURRENT_BUILD, version: '3f1ed09' },
						bakeStatus: 'Succeeded',
						timestamp: '2026-10-08T09:00:00Z'
					},
					{
						version: { tag: FAILED_BUILD, version: 'a02f1c4' },
						bakeStatus: 'Failed',
						timestamp: '2026-10-08T08:52:00Z'
					}
				],
				// A real gate ALSO refuses this exact build — the co-occurring
				// case the old `!isBlocked &&` guard mishandled.
				gates: [{ name: 'promotion-prod-us-east-2', passing: true, allowedVersions: [CURRENT_BUILD] }]
			}
		});
	}

	it('true when the build failed here, independent of whether a gate also holds it', () => {
		const r = failedAndHeldRollout();
		const failedHere = failedHereVerdict(r, FAILED_BUILD);
		expect(failedHere.kind).toBe('failed');
		// The same build IS ALSO gate-held — the fact `isBlocked` used to be
		// built from, and used to suppress `justFailed`.
		expect(blockingGateNames(r, FAILED_BUILD)).toEqual(['promotion-prod-us-east-2']);
		// FAILED still takes the row.
		expect(rowShowsFailed(failedHere)).toBe(true);
	});

	it('false for a clean build, gate-held or not', () => {
		const r = failedAndHeldRollout();
		const failedHere = failedHereVerdict(r, CURRENT_BUILD);
		expect(failedHere.kind).toBe('clean');
		expect(rowShowsFailed(failedHere)).toBe(false);
	});
});

import { holdersPhrase } from './deploy-risk';
describe('holdersPhrase (QA #22 / round 2): the notice counts, the rule list names', () => {
	it('one', () => expect(holdersPhrase(['Manual approval'])).toBe('a rule is still holding back'));
	it('several', () => expect(holdersPhrase(['A', 'B', 'C'])).toBe('3 rules are still holding back'));
	it('none known', () => expect(holdersPhrase([])).toBe('a rule is still holding back'));
});
