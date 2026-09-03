import { describe, it, expect } from 'vitest';
import {
	deployActs,
	rollbackCount,
	historyAtLimit,
	isSystemDefaultNote,
	systemNoteDescription
} from './history-marks';
import { detectRollback } from './rollout-cards';

// The live hub, 2026-08-30, `hello-world-prod/hello-world-app` — the exact
// state a UX critic drove the branch into. Five deploys, all `Succeeded`, and
// two of them moved production backwards. The history tab rendered five green
// ticks and `100% success`.
const AVAILABLE = Array.from({ length: 21 }, (_, i) => `rel-${i}`);
AVAILABLE[0] = '51b976a';
AVAILABLE[5] = '991829b';
AVAILABLE[7] = 'aa17645';
AVAILABLE[19] = '0afab6f';

function rollout(history: string[], opts: { versionHistoryLimit?: number } = {}) {
	return {
		metadata: { name: 'hello-world-app', namespace: 'hello-world-prod' },
		spec: { versionHistoryLimit: opts.versionHistoryLimit },
		status: {
			history: history.map((v, i) => ({
				version: { version: v },
				timestamp: `2026-08-3${i === 0 ? 0 : 0}T2${3 - i}:00:00Z`,
				bakeStatus: 'Succeeded'
			})),
			availableReleases: AVAILABLE.map((v) => ({ version: v }))
		}
	} as any;
}

const LIVE = rollout(['991829b', '0afab6f', '51b976a', 'aa17645', '51b976a']);

describe('deployActs', () => {
	it('names both rollbacks in the live five-deploy history', () => {
		const acts = deployActs(LIVE);
		expect(acts.map((a) => a?.kind ?? 'none')).toEqual([
			'rollback', // 991829b (5) replaced 0afab6f (19)
			'forward', // 0afab6f (19) replaced 51b976a (0)
			'rollback', // 51b976a (0) replaced aa17645 (7)
			'forward', // aa17645 (7) replaced 51b976a (0)
			'none' // oldest entry — nothing precedes it
		]);
		expect(acts[0]).toMatchObject({ by: 14, from: '0afab6f', to: '991829b' });
		expect(acts[2]).toMatchObject({ by: 7, from: 'aa17645', to: '51b976a' });
		expect(rollbackCount(LIVE)).toBe(2);
	});

	// ⛔ THE ANTI-DRIFT TEST. `/` and `/rollouts` flag the current rollback via
	// `detectRollback`; the history page flags every one via `deployActs`. If
	// these two ever disagree at index 0, two surfaces tell an operator two
	// different stories about the same deploy — which is the defect the whole
	// module exists to close.
	it('agrees with rollout-cards::detectRollback about the newest deploy', () => {
		for (const h of [
			['991829b', '0afab6f', '51b976a'],
			['0afab6f', '51b976a'],
			['51b976a', 'aa17645'],
			['aa17645', 'aa17645'],
			['unknown-tag', '0afab6f'],
			['0afab6f']
		]) {
			const r = rollout(h);
			const mark = detectRollback(r);
			const act = deployActs(r)[0];
			if (mark) {
				expect(act).toMatchObject({ kind: 'rollback', by: mark.by, from: mark.from, to: mark.to });
			} else {
				expect(act?.kind).not.toBe('rollback');
			}
		}
	});

	it('stays silent when a version has no position in availableReleases', () => {
		const acts = deployActs(rollout(['not-a-release', '0afab6f']));
		expect(acts[0]).toBeNull();
		expect(rollbackCount(rollout(['not-a-release', '0afab6f']))).toBe(0);
	});

	it('calls a same-version deploy a redeploy, not a rollback', () => {
		const acts = deployActs(rollout(['0afab6f', '0afab6f']));
		expect(acts[0]?.kind).toBe('redeploy');
	});

	it('returns nothing for an empty or single-entry history', () => {
		expect(deployActs(null)).toEqual([]);
		expect(deployActs(rollout(['0afab6f']))).toEqual([null]);
	});

	// ⛔ THE RETRACTIVE-UN-LABELLING BUG (2026-09-03, operator-walk finding
	// 13). `hello-world-dev/hello-world-app`'s live `versionHistoryLimit: 5`
	// evicted the entry a rollback's "from" pointed at, and the row silently
	// stopped being a rollback — `null` and "genuinely nothing preceded this"
	// are not the same fact.
	describe('the oldest surviving entry, when retention may have evicted one before it', () => {
		it('is "unknown", not null, once history is at the retention limit', () => {
			// Five forward-only deploys (no rollback anywhere in this fixture) —
			// isolates the oldest-entry classification from `rollback` itself.
			const r = rollout(['rel-10', 'rel-9', 'rel-8', 'rel-7', 'rel-6'], {
				versionHistoryLimit: 5
			});
			expect(historyAtLimit(r)).toBe(true);
			const acts = deployActs(r);
			expect(acts[4]).toMatchObject({ kind: 'unknown' });
			// Unknown is not counted either way — `rollbackCount` only tallies
			// `kind === 'rollback'`, so the unknown entry contributes to neither
			// the rollback count nor a "no rollbacks" claim.
			expect(rollbackCount(r)).toBe(0);
		});

		it('stays null below the limit — the history is provably complete', () => {
			const r = rollout(['aa17645', '51b976a', '991829b'], { versionHistoryLimit: 5 });
			expect(historyAtLimit(r)).toBe(false);
			expect(deployActs(r)[2]).toBeNull();
		});

		it('falls back to the CRD default (10) when the limit is unset', () => {
			const nine = Array.from({ length: 9 }, () => 'rel-1');
			expect(historyAtLimit(rollout(nine))).toBe(false);
			const ten = Array.from({ length: 10 }, () => 'rel-1');
			expect(historyAtLimit(rollout(ten))).toBe(true);
			expect(deployActs(rollout(ten))[9]).toMatchObject({ kind: 'unknown' });
		});
	});
});

describe('isSystemDefaultNote / systemNoteDescription (2026-09-03, operator-walk P11)', () => {
	// Every string here is a LITERAL from `rollout-dashboard/main.go`'s
	// `/pin`, `/force-deploy` and `/change-version` handlers' default
	// `explanation`/`message` values — the controller's own boilerplate for
	// a blank reason field, not a guess at what one might look like.
	it('recognises every controller default, from the live handlers', () => {
		expect(isSystemDefaultNote('Cleared version pin')).toBe(true);
		expect(isSystemDefaultNote('Pinned version')).toBe(true);
		expect(isSystemDefaultNote('Force deploy')).toBe(true);
		expect(isSystemDefaultNote('Pinned to version 0afab6f')).toBe(true);
		expect(isSystemDefaultNote('Force deploy version 0afab6f')).toBe(true);
	});

	it('leaves a genuine, human-typed note alone', () => {
		expect(isSystemDefaultNote('Rolling back — bad config in prod')).toBe(false);
		expect(isSystemDefaultNote('')).toBe(false);
		expect(isSystemDefaultNote(null)).toBe(false);
		expect(isSystemDefaultNote(undefined)).toBe(false);
	});

	it('describes the default as a fact about the system, same words, lower case', () => {
		expect(systemNoteDescription('Force deploy')).toBe('force deploy');
		expect(systemNoteDescription('Pinned version')).toBe('pinned version');
		expect(systemNoteDescription('Cleared version pin')).toBe('cleared version pin');
		expect(systemNoteDescription('Pinned to version 0afab6f')).toBe('pinned to version 0afab6f');
	});
});
