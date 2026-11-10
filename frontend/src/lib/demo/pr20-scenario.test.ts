import { describe, expect, it } from 'vitest';
import { resetDemoState } from './state';
import { respond } from './respond';
import { buildChangeRows, standingWords } from '../view-models/changes';
import type { ChangesResponse } from '../api/changes';

/**
 * ⭐ (2026-10-10, squad-changes TASK 2) PR #20'S STATE, PINNED PER SCENARIO.
 *
 * `demo commit 679e743` ("the viewer owns a failed and a held change")
 * intended `exampleco/platform-telemetry` PR #20 (`4a8d2e6`) to read HELD
 * FOR APPROVAL in `incident` (blocked on `telemetry-indexer-prod`'s
 * `telemetry-indexer-manual-approval` gate) and FAILED only in `wide`
 * (`telemetry-forwarder-prod`'s bake, the `TM_ALWAYS_FAILED_KEY` exemption
 * in `state.ts`'s `healRolloutFailures` — `wide`-only since round 5 QA-5
 * item 2's TL correction).
 *
 * INVESTIGATION NOTE for whoever reopens this: a worktree-level trace
 * (`buildChangeRows` fed `getScenarioFleetRollouts()`/`getScenarioDepRollouts()`
 * directly, bypassing `respond.ts`'s `withLiveOverrides`) found the fleet
 * array's own healing correct for BOTH telemetry cells in every scenario —
 * no regression there. The failure mode this test guards against is
 * EXACTLY the one a prior round's own doc comments in `state.ts` (lines
 * ~636-657) record already having fixed once (the `TM_ALWAYS_FAILED_KEY`
 * exemption briefly living under `scenario === 'incident'` instead of
 * `'wide'`, which kept `telemetry-forwarder-prod` permanently `Failed` and
 * let `changeStateRankFor`'s failed-beats-held precedence,
 * `rollout-cards.ts:199-203`, override the intended HELD verdict) — this
 * pins the CURRENT, correct behaviour so a future edit that reintroduces
 * that regression fails loudly instead of waiting for the next manual
 * walk of `/changes`.
 */
function pr20Row(scenario: 'calm' | 'incident' | 'wide') {
	resetDemoState(scenario);
	const rolloutsRes = respond('GET', '/api/rollouts');
	const rolloutsBody = JSON.parse(rolloutsRes.body!);
	const changesRes = respond('GET', '/api/github/changes?days=365');
	const changesBody = JSON.parse(changesRes.body!) as ChangesResponse;
	const pr20 = changesBody.changes.find(
		(c) => c.repo === 'platform-telemetry' && c.number === 20
	);
	expect(pr20, 'platform-telemetry PR #20 (4a8d2e6) must exist in the fixture universe').toBeTruthy();
	const rows = buildChangeRows(
		[pr20!],
		rolloutsBody.rollouts.items,
		rolloutsBody.environments.items,
		{ items: rolloutsBody.rolloutDependencies.items },
		new Date()
	);
	return rows[0];
}

describe('platform-telemetry PR #20 — state pinned per scenario', () => {
	it('incident: held for approval, never failed', () => {
		const row = pr20Row('incident');
		expect(row.verdictTone).toBe('held');
	});

	it('wide: failed', () => {
		const row = pr20Row('wide');
		expect(row.verdictTone).toBe('failed');
	});

	it('calm: neither failed nor held (the approval is granted, nothing fails in calm)', () => {
		const row = pr20Row('calm');
		expect(row.verdictTone).not.toBe('failed');
		expect(row.verdictTone).not.toBe('held');
	});
});

/**
 * ⭐ shared/approval-words (2026-10-12, coordinator ruling). PR #20's own
 * `incident` row is held on `telemetry-indexer-prod`'s real manual-approval
 * gate (`telemetry-indexer-manual-approval`, `mock-data.ts`'s `TM_CELLS`) —
 * the exact shape six blind reads of Home mistook for a rule hold because
 * `ChangeLine`'s standing word read "held in prod" for an approval wait
 * indistinguishably from a rule hold. This pins the fixed wording directly
 * against the real pipeline (never a hand-built `ChangeRowVM`), so a future
 * edit to `pr-pipeline.ts`'s gate classification that reopens the "approval
 * reads as held" defect fails here, not just in a unit test with a fixture
 * someone could accidentally keep in sync with the bug.
 */
describe('platform-telemetry PR #20 — the approval wait reads "waits for you", never "held"', () => {
	it('incident: the standing word is "waits for you in prod"', () => {
		const row = pr20Row('incident');
		expect(standingWords(row)).toBe('waits for you in prod');
	});

	it('incident: the standing word never contains "held"', () => {
		const row = pr20Row('incident');
		expect(standingWords(row).toLowerCase()).not.toContain('held');
	});

	it('wide: a real failure still reads "failed in prod" — this ruling only touches approval holds', () => {
		const row = pr20Row('wide');
		expect(standingWords(row)).toBe('failed in prod');
	});
});
