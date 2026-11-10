import { describe, expect, it } from 'vitest';
import { resetDemoState } from './state';
import { respond } from './respond';
import { respondGithub } from './github-data';
import { buildChangeRows, standingWords, familyProgress } from '../view-models/changes';
import type { ChangesResponse } from '../api/changes';

/**
 * ⭐ QA FIX (round 2, 2026-10-11) — CARRIER SHA AGAINST THE REAL DEMO, NOT
 * JUST THE HAND-BUILT platform-telemetry PAIR. QA's own probe
 * (`buildChangeRows` over the live `calm` feed) found the round-1 carrier
 * logic false on ~20 rows: it compared a 7-char `change.mergeCommitSha`
 * against a (often 40-char) `PrCell.revision` with raw `!==`, so a row still
 * promoting ITSELF read "promoting to prod · in <its own sha>" — e.g.
 * `edge-mesh` #? "5e1a903", a real row in `calm`, named "5e1a903" as its own
 * carrier. This file pins the fix against that same live feed.
 */
describe('carrierSha against the real calm feed (QA round 2)', () => {
	it('a row genuinely still promoting itself carries no suffix — same sha, not a different build', () => {
		resetDemoState('calm');
		const rolloutsRes = respond('GET', '/api/rollouts');
		const rolloutsBody = JSON.parse(rolloutsRes.body!);
		const changesRes = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
		const changesBody = JSON.parse(changesRes!.body) as ChangesResponse;
		const rows = buildChangeRows(
			changesBody.changes,
			rolloutsBody.rollouts.items,
			rolloutsBody.environments.items,
			{ items: rolloutsBody.rolloutDependencies.items },
			new Date()
		);

		// No row anywhere in the feed names ITS OWN sha as its carrier — the
		// exact shape of the bug QA found (a 7-char/40-char mismatch reading
		// the same commit as two different builds).
		const selfCarrier = rows.filter((r) => r.carrierSha && r.sha.toLowerCase().startsWith(r.carrierSha.toLowerCase()));
		expect(
			selfCarrier.map((r) => `${r.repo}#${r.number ?? r.shortSha}: ${r.shortSha} carrierSha=${r.carrierSha}`)
		).toEqual([]);
	});

	/**
	 * ⭐ A RESOLVED ROW'S STANDING WORD MUST NEVER REGRESS TO A LIVE COUNT,
	 * AND NEVER CARRIES A SUFFIX EITHER. This is the core guarantee behind
	 * BUG 1's item-1 QA correction: a `rolled-back` family must still read
	 * "rolled back in prod-eu-central" (named by region since the D1 fix,
	 * round 3), never "3 of 3 live · in <sha>" (round 1's defect, live
	 * payments-core rows).
	 *
	 * ⛔ STALE COMMENT FIXED (QA round 4, 2026-10-11). This used to say the
	 * carrier suffix was a SEPARATE, legitimate fact here and NOT required
	 * to be null — `payments-core #88` (a real row in this fixture) was
	 * cited as "rolled back in prod · in 9b7e410" (one region rolled back,
	 * five others genuinely carried forward). The coordinator's final ruling
	 * (D3, round 4) overrides that: `frontierStandingCell` now calls
	 * `frontierStandingStep` directly and returns `null` whenever the picked
	 * step is `anyResolved` — ANY rollback in the family, partial or full —
	 * never only the all-resolved case. Naming a different build as the
	 * "carrier" in the same breath as naming a rollback reads as two
	 * disagreeing facts about the same row, even when the carrier claim is
	 * technically true of OTHER regions. `payments-core #88` now reads
	 * "rolled back in prod-eu-central" with `carrierSha: null` — verified
	 * below, not just asserted.
	 */
	it('a resolved (rolled-back) row never regresses its standing word to a live count, and never carries a suffix', () => {
		resetDemoState('calm');
		const rolloutsRes = respond('GET', '/api/rollouts');
		const rolloutsBody = JSON.parse(rolloutsRes.body!);
		const changesRes = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
		const changesBody = JSON.parse(changesRes!.body) as ChangesResponse;
		const rows = buildChangeRows(
			changesBody.changes,
			rolloutsBody.rollouts.items,
			rolloutsBody.environments.items,
			{ items: rolloutsBody.rolloutDependencies.items },
			new Date()
		);

		const rolledBack = rows.filter((r) => standingWords(r).startsWith('rolled back'));
		// payments-core's own rolled-back-in-prod rows (QA's own probe
		// evidence) must exist in this fixture; if the scenario ever stops
		// producing one, this assertion fails loudly instead of the test
		// silently covering nothing.
		expect(rolledBack.length).toBeGreaterThan(0);
		for (const row of rolledBack) {
			expect(standingWords(row)).not.toMatch(/\d+ of \d+ live/);
			// D3 (round 4): never a carrier, full stop — partial or total
			// rollback alike.
			expect(row.carrierSha, `${row.repo}#${row.number ?? row.shortSha}: ${standingWords(row)}`).toBeNull();
		}

		// The named example from the coordinator's own ruling.
		const pc88 = rows.find((r) => r.repo === 'payments-core' && r.number === 88);
		expect(pc88, 'payments-core #88 must exist in this fixture').toBeTruthy();
		expect(standingWords(pc88!)).toBe('rolled back in prod-eu-central');
		expect(pc88!.carrierSha).toBeNull();
	});

	it('every carrierSha, where set, is a sha GitHub actually verified this change is contained in', () => {
		resetDemoState('calm');
		const rolloutsRes = respond('GET', '/api/rollouts');
		const rolloutsBody = JSON.parse(rolloutsRes.body!);
		const changesRes = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
		const changesBody = JSON.parse(changesRes!.body) as ChangesResponse;
		const rows = buildChangeRows(
			changesBody.changes,
			rolloutsBody.rollouts.items,
			rolloutsBody.environments.items,
			{ items: rolloutsBody.rolloutDependencies.items },
			new Date()
		);
		const byKey = new Map(changesBody.changes.map((c) => [`${c.owner}/${c.repo}#${c.number ?? c.mergeCommitSha}`, c]));

		for (const row of rows) {
			if (!row.carrierSha) continue;
			const change = byKey.get(`${row.owner}/${row.repo}#${row.number ?? row.sha}`);
			expect(change, `${row.repo}#${row.number ?? row.shortSha} should resolve back to its own Change`).toBeTruthy();
			const inContained = (change!.containedIn ?? []).some(
				(sha) => sha.toLowerCase().startsWith(row.carrierSha!.toLowerCase()) || row.carrierSha!.toLowerCase().startsWith(sha.toLowerCase())
			);
			expect(inContained, `${row.repo}#${row.number ?? row.shortSha}: carrierSha ${row.carrierSha} not in containedIn`).toBe(
				true
			);
		}
	});
});

/**
 * ⭐ THE HELD-PREDICATE CORRECTION, AGAINST THE REAL CALM FEED (QA round 3,
 * 2026-10-11). `pr-pipeline.ts`'s `buildCell` now reads `held.ts`'s
 * `heldVerdict` directly (not the old `promotionHoldBreakdown(...).allHeld`,
 * which could not tell a chain-refused candidate from a genuinely held one)
 * — `familyProgress`'s own genuine-held check inherits the fix. `hello-world`
 * #e2c9b47's own PR is "promoting to dev", staging/prod both merely queued
 * behind it (the build has not reached them yet) — this must never read
 * `stuck`/held anywhere.
 */
describe('held-predicate correction against the real calm feed (QA round 3)', () => {
	it('hello-world: a build only promoting through dev reads queued downstream, never held', () => {
		resetDemoState('calm');
		const rolloutsRes = respond('GET', '/api/rollouts');
		const rolloutsBody = JSON.parse(rolloutsRes.body!);
		const changesRes = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
		const changesBody = JSON.parse(changesRes!.body) as ChangesResponse;
		const rows = buildChangeRows(
			changesBody.changes,
			rolloutsBody.rollouts.items,
			rolloutsBody.environments.items,
			{ items: rolloutsBody.rolloutDependencies.items },
			new Date()
		);
		const helloWorldRows = rows.filter((r) => r.repo === 'hello-world');
		expect(helloWorldRows.length).toBeGreaterThan(0);
		for (const row of helloWorldRows) {
			const steps = familyProgress(row);
			expect(steps.every((s) => s.tone !== 'stuck'), `${row.shortSha}: ${standingWords(row)}`).toBe(true);
		}
	});
});

/**
 * ⭐ QA FIX (round 6, 2026-10-12) — THE WORD FOLLOWS THE FURTHEST LIVE
 * STAGE, NOT THE FIRST NOT-YET-REACHED ONE. `d0ff17e` (payments-core) is a
 * real row in `calm`: dev/test/staging all read `queued` (a NEWER build
 * superseded this one there), while ONE prod region is genuinely `live` —
 * this build reached further than dev. `frontierStandingStep`'s old
 * "first not-yet-reached" scan picked dev anyway, reading "queued for dev"
 * — true of dev in isolation, but actively misleading about where this
 * build actually got to. Fixed to mirror `journey.ts`'s own `pickFrontier`
 * (furthest REACHED, not first unreached) at the family-step grain.
 */
describe('frontier pick follows the furthest live stage (QA round 6)', () => {
	it('d0ff17e (payments-core): reads the row-wide live count and names what the frontier family is still doing, never "queued for dev"', () => {
		resetDemoState('calm');
		const rolloutsRes = respond('GET', '/api/rollouts');
		const rolloutsBody = JSON.parse(rolloutsRes.body!);
		const changesRes = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
		const changesBody = JSON.parse(changesRes!.body) as ChangesResponse;
		const rows = buildChangeRows(
			changesBody.changes,
			rolloutsBody.rollouts.items,
			rolloutsBody.environments.items,
			{ items: rolloutsBody.rolloutDependencies.items },
			new Date()
		);
		const row = rows.find((r) => r.repo === 'payments-core' && r.sha.startsWith('d0ff17e'));
		expect(row, 'payments-core d0ff17e must exist in this fixture').toBeTruthy();
		expect(standingWords(row!)).not.toBe('queued for dev');
		expect(standingWords(row!)).toBe('1 of 9 live · queued for 5');
	});
});
