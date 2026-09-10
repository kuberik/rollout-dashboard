import { describe, it, expect } from 'vitest';
import {
	cellStateSentence,
	cellReasonText,
	usuallyLabel,
	frontierUsuallyLabel,
	frontierUsuallyLabelForCell,
	reasonTail,
	sinceLabel,
	checksLine
} from './pr-cell-copy';
import type { PrCell, PrState } from './view-models/pr-pipeline';
import type { PrChecks } from './api/pulls';

const NOW = new Date('2026-09-10T12:00:00Z');

function mkCell(state: PrState, overrides: Partial<PrCell> = {}): PrCell {
	return {
		cluster: 'hub',
		envName: 'dev',
		namespace: 'widget-dev',
		rolloutName: 'widget-app',
		theme: null,
		envRank: 1,
		state,
		reason: '',
		since: null,
		usuallyMs: null,
		bakeLeftMs: null,
		releaseLabel: '',
		revision: null,
		superseded: false,
		gateHint: null,
		gateLabel: null,
		gateSubject: null,
		gateSubjectKind: null,
		gatePending: false,
		containmentKnown: true,
		...overrides
	};
}

describe('cellStateSentence', () => {
	it('not-built', () => {
		expect(cellStateSentence(mkCell('not-built'))).toBe('not built yet');
	});

	// ⭐ RULING 2 (CHANGES-2026-09-10 fix pass, "NOT-BUILT HAS NO ETA").
	it('not-built, builtElsewhere: true — names the fact that this SERVICE has no build, not that nothing has built', () => {
		const cell = mkCell('not-built');
		expect(cellStateSentence(cell, NOW, { builtElsewhere: true })).toBe(
			'no build of this change for this service'
		);
	});

	it('not-built, builtElsewhere omitted/false — the plain reading', () => {
		expect(cellStateSentence(mkCell('not-built'), NOW, { builtElsewhere: false })).toBe('not built yet');
	});

	// ⭐ RULING 1 (CHANGES-2026-09-10 fix pass, "SUPERSEDED IS LIVE"). The
	// unverified-containment reading always wins over `builtElsewhere` — "we
	// don't know" outranks "we know it's missing here specifically".
	it('not-built, "not built (unverified)" wins over builtElsewhere', () => {
		const cell = mkCell('not-built', { reason: 'not built (unverified)' });
		expect(cellStateSentence(cell, NOW, { builtElsewhere: true })).toBe('not built (unverified)');
	});

	it('held by a named rule (never "gated by" — the noun is retired)', () => {
		const cell = mkCell('gated', { gateLabel: 'Business Hours Only', reason: 'Outside the Business Hours Only deploy window' });
		expect(cellStateSentence(cell)).toBe('held by Business Hours Only');
	});

	it('held by a rule (generic) when the label is unresolved (gatePending) — never the raw gate id', () => {
		const cell = mkCell('gated', { gateLabel: null, gatePending: true, reason: '' });
		expect(cellStateSentence(cell)).toBe('held by a rule');
	});

	it('promoting: nothing is blocking it, just not reconciled yet — no "gated"/"ready" wording', () => {
		const cell = mkCell('promoting', { reason: 'waiting for the next reconcile' });
		expect(cellStateSentence(cell)).toBe('promoting shortly');
	});

	it('pinned reuses the view-model\'s own "pinned to X" text verbatim', () => {
		const cell = mkCell('pinned', { reason: 'pinned to 2.66.0-66' });
		expect(cellStateSentence(cell)).toBe('pinned to 2.66.0-66');
	});

	it('waiting-upstream on a dependency names the provider', () => {
		const cell = mkCell('waiting-upstream', { gateSubject: 'hello-api-app', gateSubjectKind: 'service' });
		expect(cellStateSentence(cell)).toBe('waiting on hello-api-app');
	});

	it('waiting-upstream on a promotion order reads "waiting for X to deploy it first", not "waiting on"', () => {
		const cell = mkCell('waiting-upstream', { gateSubject: 'dev', gateSubjectKind: 'environment' });
		expect(cellStateSentence(cell)).toBe('waiting for dev to deploy it first');
	});

	it('waiting-upstream falls back when no subject resolved', () => {
		const cell = mkCell('waiting-upstream', { gateSubject: null });
		expect(cellStateSentence(cell)).toBe('waiting on its upstream');
	});

	it('deploying', () => {
		expect(cellStateSentence(mkCell('deploying'))).toBe('deploying');
	});

	it('baking — matches pr-pipeline.ts\'s own "furthest"/"verdict" vocabulary, not bake-status.ts\'s "checking"', () => {
		expect(cellStateSentence(mkCell('baking'))).toBe('baking');
	});

	it('baking with a budget prints elapsed of total minutes', () => {
		const cell = mkCell('baking', {
			since: '2026-09-10T11:56:00Z', // 4 minutes ago
			bakeLeftMs: 6 * 60_000 // 6 minutes left → 10 total
		});
		expect(cellStateSentence(cell, NOW)).toBe('baking · 4 of 10 min');
	});

	it('baking with no timer omits the fraction', () => {
		const cell = mkCell('baking', { since: '2026-09-10T11:56:00Z', bakeLeftMs: null });
		expect(cellStateSentence(cell, NOW)).toBe('baking');
	});

	it('retrying', () => {
		expect(cellStateSentence(mkCell('retrying'))).toBe('retrying');
	});

	it('failed', () => {
		expect(cellStateSentence(mkCell('failed'))).toBe('failed');
	});

	it('cancelled', () => {
		expect(cellStateSentence(mkCell('cancelled'))).toBe('cancelled');
	});

	it('rolled-back names the build now running', () => {
		const cell = mkCell('rolled-back', { releaseLabel: '2.65.0-64' });
		expect(cellStateSentence(cell)).toBe('rolled back to 2.65.0-64');
	});

	it('live with a since time', () => {
		const cell = mkCell('live', { since: '2026-09-10T10:00:00Z' });
		expect(cellStateSentence(cell, NOW)).toBe('live since 2h ago');
	});

	it('live with no since falls back to the view-model\'s own sentence', () => {
		const cell = mkCell('live', { since: null, reason: 'live (since before recorded history)' });
		expect(cellStateSentence(cell, NOW)).toBe('live (since before recorded history)');
	});
});

describe('cellReasonText — suppresses a line that would only restate the sentence', () => {
	it('baking never shows a reason: the sentence already carries elapsed/total', () => {
		const cell = mkCell('baking', { reason: 'baking' });
		expect(cellReasonText(cell)).toBeNull();
	});

	it('live with no supersession shows nothing extra', () => {
		expect(cellReasonText(mkCell('live', { since: '2026-09-10T10:00:00Z' }))).toBeNull();
	});

	it('live superseded names the one fact the sentence cannot carry', () => {
		const cell = mkCell('live', { since: '2026-09-10T10:00:00Z', superseded: true });
		expect(cellReasonText(cell)).toBe(
			'a later build that also carries this PR has since shipped'
		);
	});

	it('pinned suppresses the reason — identical to the sentence', () => {
		const cell = mkCell('pinned', { reason: 'pinned to 2.66.0-66' });
		expect(cellReasonText(cell)).toBeNull();
	});

	it('rolled-back with no custom message suppresses the reason', () => {
		const cell = mkCell('rolled-back', {
			releaseLabel: '2.65.0-64',
			reason: 'rolled back to 2.65.0-64'
		});
		expect(cellReasonText(cell)).toBeNull();
	});

	it('rolled-back with a real controller message keeps it', () => {
		const cell = mkCell('rolled-back', {
			releaseLabel: '2.65.0-64',
			reason: 'Automatic rollback: failing health checks'
		});
		expect(cellReasonText(cell)).toBe('Automatic rollback: failing health checks');
	});

	it('not-built suppresses the plain fallback', () => {
		expect(cellReasonText(mkCell('not-built', { reason: 'not built here yet' }))).toBeNull();
	});

	// ⭐ RULING 1 (2026-09-10 fix pass). `cellStateSentence` itself now prints
	// "not built (unverified)" as the PRIMARY sentence (not just "not built
	// yet"), so a secondary reason line repeating the exact same words is
	// exactly the redundancy this module's own "ONE FACT, DRAWN, IS THE END
	// OF ITS SENTENCE" rule (module doc, top of file) suppresses — same
	// reasoning as `pinned`/`rolled-back`'s own suppression above.
	it('not-built (unverified): the primary sentence already carries it, so the reason line is suppressed', () => {
		expect(cellReasonText(mkCell('not-built', { reason: 'not built (unverified)' }))).toBeNull();
	});

	it('deploying suppresses its own fallback text', () => {
		expect(cellReasonText(mkCell('deploying', { reason: 'deploying now' }))).toBeNull();
	});

	it('retrying suppresses the plain fallback', () => {
		expect(cellReasonText(mkCell('retrying', { reason: 'retrying the bake' }))).toBeNull();
	});

	it('retrying keeps a real controller message', () => {
		expect(cellReasonText(mkCell('retrying', { reason: 'stalled probe, retrying' }))).toBe(
			'stalled probe, retrying'
		);
	});

	it('failed suppresses the plain fallback', () => {
		expect(cellReasonText(mkCell('failed', { reason: 'the bake failed' }))).toBeNull();
	});

	it('cancelled suppresses the plain fallback', () => {
		expect(cellReasonText(mkCell('cancelled', { reason: 'the bake was cancelled' }))).toBeNull();
	});

	it('gated + gatePending: empty reason, nothing to show (PipelineRow renders a SkeletonBar instead)', () => {
		const cell = mkCell('gated', { gateLabel: null, gatePending: true, reason: '' });
		expect(cellReasonText(cell)).toBeNull();
	});

	it('gated keeps the gate clause beside the fixed sentence', () => {
		const cell = mkCell('gated', {
			gateLabel: 'hello-world-manual-approval',
			reason: 'Waiting for someone to approve it'
		});
		expect(cellReasonText(cell)).toBe('Waiting for someone to approve it');
	});

	it('waiting-upstream keeps the dependency clause beside the fixed sentence', () => {
		const cell = mkCell('waiting-upstream', {
			gateSubject: 'hello-api-app',
			reason: 'Waiting for hello-api-app to ship api ^1.67.0 — it is on 1.66.0'
		});
		expect(cellReasonText(cell)).toBe(
			'Waiting for hello-api-app to ship api ^1.67.0 — it is on 1.66.0'
		);
	});

});

describe('usuallyLabel', () => {
	it('em dash under the 2-sample guard', () => {
		expect(usuallyLabel(null)).toBe('—');
	});

	it('rounds to whole minutes', () => {
		expect(usuallyLabel(11.6 * 60_000)).toBe('usually 12 min');
	});

	it('never rounds down to 0 min', () => {
		expect(usuallyLabel(10_000)).toBe('usually 1 min');
	});
});

describe('frontierUsuallyLabel (CHANGES-2026-09-10 §7, item 1)', () => {
	it('rounds to whole minutes, "once it starts"', () => {
		expect(frontierUsuallyLabel(11.6 * 60_000)).toBe('usually 12 min once it starts');
	});

	it('never rounds down to 0 min', () => {
		expect(frontierUsuallyLabel(10_000)).toBe('usually 1 min once it starts');
	});
});

describe('frontierUsuallyLabelForCell — guarded, ruling 2 (CHANGES-2026-09-10 fix pass, "NOT-BUILT HAS NO ETA")', () => {
	it('never on not-built — a build that does not exist has no ETA', () => {
		expect(frontierUsuallyLabelForCell(mkCell('not-built', { usuallyMs: 6 * 60_000 }))).toBeNull();
	});

	it('prints a label on every state whose service HAS a build (gated/pinned/waiting-upstream/promoting)', () => {
		for (const state of ['gated', 'pinned', 'waiting-upstream', 'promoting'] as const) {
			expect(frontierUsuallyLabelForCell(mkCell(state, { usuallyMs: 6 * 60_000 }))).toBe(
				'usually 6 min once it starts'
			);
		}
	});

	it('null under the 2-sample guard even on a state that has a build', () => {
		expect(frontierUsuallyLabelForCell(mkCell('gated', { usuallyMs: null }))).toBeNull();
	});

	it('never on a state already in flight (deploying/baking) — that is `usuallyLabel`\'s own job', () => {
		expect(frontierUsuallyLabelForCell(mkCell('deploying', { usuallyMs: 6 * 60_000 }))).toBeNull();
		expect(frontierUsuallyLabelForCell(mkCell('baking', { usuallyMs: 6 * 60_000 }))).toBeNull();
	});
});

describe('reasonTail — fix pass item 2, "JOIN THE REASON REACHES THE READER"', () => {
	it('strips the shared "waiting on X" subject, keeping only the added fact', () => {
		const cell = mkCell('waiting-upstream', {
			gateSubject: 'hello-api-app',
			gateSubjectKind: 'service',
			reason: 'waiting on hello-api-app — its build of this change does not exist yet'
		});
		expect(reasonTail(cell, NOW)).toBe('its build of this change does not exist yet');
	});

	it('null when the reason is a single clause with no shared-subject split (the promotion-order variant)', () => {
		const cell = mkCell('waiting-upstream', {
			gateSubject: 'hello-api-app',
			gateSubjectKind: 'service',
			reason: 'waiting on hello-api-app to reach dev'
		});
		expect(reasonTail(cell, NOW)).toBeNull();
	});

	it('null when cellReasonText itself would suppress the reason', () => {
		expect(reasonTail(mkCell('baking'), NOW)).toBeNull();
		expect(reasonTail(mkCell('live'), NOW)).toBeNull();
	});

	it('null on a plain gated cell whose reason clause does not restate the sentence', () => {
		const cell = mkCell('gated', { gateLabel: 'a manual approval', reason: 'needs sign-off' });
		expect(reasonTail(cell, NOW)).toBeNull();
	});
});

describe('sinceLabel', () => {
	it('null when the cell names no instant', () => {
		expect(sinceLabel(mkCell('gated'))).toBeNull();
	});

	it('relative time otherwise', () => {
		const cell = mkCell('live', { since: '2026-09-10T10:00:00Z' });
		expect(sinceLabel(cell, NOW)).toBe('2h ago');
	});
});

describe('checksLine', () => {
	function mkChecks(overrides: Partial<PrChecks> = {}): PrChecks {
		return { state: 'success', total: 0, failed: 0, url: null, ...overrides };
	}

	it('null when there is no checks fact at all (data not yet loaded)', () => {
		expect(checksLine(undefined)).toBeNull();
		expect(checksLine(null)).toBeNull();
	});

	it("nothing for 'none' — the design doc's own words", () => {
		expect(checksLine(mkChecks({ state: 'none' }))).toBeNull();
	});

	it('"checks passing" for success', () => {
		expect(checksLine(mkChecks({ state: 'success' }))?.text).toBe('checks passing');
	});

	it('"checks pending" while still running', () => {
		expect(checksLine(mkChecks({ state: 'pending' }))?.text).toBe('checks pending');
	});

	it('"N of M checks failing" on failure', () => {
		expect(checksLine(mkChecks({ state: 'failure', total: 7, failed: 2 }))?.text).toBe(
			'2 of 7 checks failing'
		);
	});

	it('carries the href through when the backend supplied one', () => {
		const line = checksLine(mkChecks({ state: 'failure', total: 7, failed: 2, url: 'https://github.com/o/r/pull/1/checks' }));
		expect(line?.href).toBe('https://github.com/o/r/pull/1/checks');
	});

	it('href is null when the backend sent none', () => {
		expect(checksLine(mkChecks({ state: 'success', url: null }))?.href).toBeNull();
	});
});
