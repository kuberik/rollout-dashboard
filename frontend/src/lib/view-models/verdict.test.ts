import { describe, it, expect } from 'vitest';
import { verdictSentence, blockReason, type VerdictEnv } from './verdict';

function env(over: Partial<VerdictEnv> & { label: string }): VerdictEnv {
	return {
		status: 'Succeeded',
		behind: 0,
		blocked: false,
		stuck: false,
		awaitingApprovalGates: [],
		notPassingGates: [],
		stuckKind: null,
		stuckForMs: null,
		version: '9f10e49',
		...over
	};
}

const dev = env({ label: 'dev' });
const staging = env({ label: 'staging' });

describe('blockReason', () => {
	it('names a person when a gate published an allow-list and said no', () => {
		expect(
			blockReason({ awaitingApprovalGates: ['hello-world-manual-approval'], notPassingGates: [] })
		).toBe('a manual approval');
	});

	it('names a clock when the block is only time/condition bounded', () => {
		expect(blockReason({ awaitingApprovalGates: [], notPassingGates: ['schedule-gate-q25wv'] })).toBe(
			'a deploy window'
		);
	});

	it('prefers the person when BOTH kinds are blocking — that is the one that will not clear on its own', () => {
		expect(
			blockReason({
				awaitingApprovalGates: ['hello-world-manual-approval'],
				notPassingGates: ['schedule-gate-q25wv']
			})
		).toBe('a manual approval');
	});

	// THE REGRESSION PIN. This used to return the string 'a gate', which is
	// reached exactly when no gate refused anything — so the one caller,
	// the biggest sentence on the page, printed "waiting on a gate" for an
	// app that declares no gates at all. A fallback noun IS a fabricated
	// cause; there is no wording that makes it true.
	it('returns null rather than naming a gate when no gate is blocking', () => {
		expect(blockReason({ awaitingApprovalGates: [], notPassingGates: [] })).toBeNull();
	});
});

describe('verdictSentence — precedence', () => {
	it('returns null for an app with no environments', () => {
		expect(verdictSentence([])).toBeNull();
	});

	it('1. Failed beats everything else', () => {
		const s = verdictSentence([
			dev,
			env({ label: 'staging', status: 'Failed' }),
			env({ label: 'prod', behind: 24, blocked: true, stuck: true, awaitingApprovalGates: ['g'] })
		]);
		expect(s).toBe("staging's last deploy failed.");
	});

	it('2. wedged beats in-flight and behind — the live hello-world-app case', () => {
		const s = verdictSentence([
			dev,
			staging,
			env({
				label: 'prod',
				behind: 24,
				blocked: true,
				stuck: true,
				awaitingApprovalGates: ['hello-world-manual-approval'],
				notPassingGates: ['schedule-gate-q25wv'],
				version: '205a312'
			})
		]);
		expect(s).toBe('prod is 24 builds behind, waiting on a manual approval.');
	});

	it('2. says "a deploy window" when only time-bounded gates block', () => {
		const s = verdictSentence([
			dev,
			env({
				label: 'prod',
				behind: 3,
				blocked: true,
				notPassingGates: ['schedule-gate-q25wv'],
				version: '205a312'
			})
		]);
		expect(s).toBe('prod is 3 builds behind, waiting on a deploy window.');
	});

	it('2. singularises one build', () => {
		const s = verdictSentence([
			dev,
			env({ label: 'prod', behind: 1, blocked: true, awaitingApprovalGates: ['g'] })
		]);
		expect(s).toBe('prod is 1 build behind, waiting on a manual approval.');
	});

	it('2. NEVER fabricates a number when the lag is unknowable', () => {
		const s = verdictSentence([
			dev,
			env({
				label: 'prod',
				behind: null,
				blocked: true,
				stuck: true,
				awaitingApprovalGates: ['hello-world-manual-approval'],
				version: '205a312'
			})
		]);
		expect(s).toBe('prod is behind, waiting on a manual approval.');
		expect(s).not.toMatch(/\d/);
	});

	it('2. drops the count entirely when a stuck env is not actually behind', () => {
		const s = verdictSentence([
			dev,
			env({ label: 'prod', behind: 0, stuck: true, awaitingApprovalGates: ['g'] })
		]);
		expect(s).toBe('prod is waiting on a manual approval.');
	});

	it('2. picks the single worst wedged env, never two sentences', () => {
		const s = verdictSentence([
			env({ label: 'staging', behind: 2, blocked: true, awaitingApprovalGates: ['g1'] }),
			env({ label: 'prod', behind: 24, blocked: true, awaitingApprovalGates: ['g2'] })
		]);
		expect(s).toBe('prod is 24 builds behind, waiting on a manual approval.');
		expect(s!.match(/\./g)).toHaveLength(1);
	});

	// ── THE EMPTY-GATES CASE ────────────────────────────────────────────
	// Every test below has BOTH gate lists empty while the env is wedged.
	// This is the `checkout-edge` fixture's shape exactly: 25 builds, three
	// envs, no `gates` array anywhere, prod's bake `InProgress` for 76h.
	// `promotionBlock` correctly reports blocked=false there (with no gates
	// `gates.every()` is vacuously true, so every candidate is deployable);
	// the wedged branch is entered on `stuck`. The old code reached
	// `blockReason`'s `'a gate'` fallback and printed a mechanism that did
	// not exist. NOTHING here may contain the word "gate".
	const HOURS = 60 * 60 * 1000;

	it('2. EMPTY GATES + baking — names the bake, which is what was measured', () => {
		const s = verdictSentence([
			dev,
			env({
				label: 'prod',
				status: 'InProgress',
				behind: 19,
				stuck: true,
				stuckKind: 'baking',
				stuckForMs: 76 * HOURS,
				version: 'd09e6f4'
			})
		]);
		expect(s).toBe('prod is 19 builds behind, baking for 3 days.');
		expect(s).not.toMatch(/gate|approval|window/i);
	});

	it('2. EMPTY GATES + deploying — names the deploy', () => {
		const s = verdictSentence([
			dev,
			env({
				label: 'prod',
				status: 'Deploying',
				behind: 4,
				stuck: true,
				stuckKind: 'deploying',
				stuckForMs: 5 * HOURS
			})
		]);
		expect(s).toBe('prod is 4 builds behind, deploying for 5 hours.');
		expect(s).not.toMatch(/gate|approval|window/i);
	});

	it('2. EMPTY GATES + behind a peer — states the observable, invents no mechanism', () => {
		const s = verdictSentence([
			dev,
			env({
				label: 'prod',
				behind: 19,
				stuck: true,
				stuckKind: 'behind',
				stuckForMs: 72 * HOURS
			})
		]);
		expect(s).toBe('prod is 19 builds behind, and has not moved in 3 days.');
		expect(s).not.toMatch(/gate|approval|window/i);
	});

	it('2. EMPTY GATES + promotion-level stuck — same observable wording', () => {
		const s = verdictSentence([
			dev,
			env({
				label: 'prod',
				behind: 19,
				stuck: true,
				stuckKind: 'promotion',
				stuckForMs: 20 * HOURS
			})
		]);
		expect(s).toBe('prod is 19 builds behind, and has not moved in 20 hours.');
		expect(s).not.toMatch(/gate|approval|window/i);
	});

	it('2. EMPTY GATES and NO KIND — the honest "we do not know why" sentence', () => {
		const s = verdictSentence([dev, env({ label: 'prod', behind: 19, stuck: true })]);
		expect(s).toBe('prod is 19 builds behind, and is not moving.');
		expect(s).not.toMatch(/gate|approval|window/i);
	});

	it('2. EMPTY GATES with blocked=true is degenerate but must still not name a gate', () => {
		// blocked=true with both lists empty can only arise if the newest
		// candidate cannot be resolved for classification. Rare, but the one
		// state where the old fallback was closest to defensible — and still
		// wrong, because "a gate" is not what we know.
		const s = verdictSentence([dev, env({ label: 'prod', behind: 6, blocked: true })]);
		expect(s).toBe('prod is 6 builds behind, and is not moving.');
		expect(s).not.toMatch(/gate|approval|window/i);
	});

	it('2. EMPTY GATES, unknowable lag, still no fabricated number OR cause', () => {
		const s = verdictSentence([
			dev,
			env({ label: 'prod', behind: null, stuck: true, stuckKind: 'baking', stuckForMs: 2 * HOURS })
		]);
		expect(s).toBe('prod is behind, baking for 2 hours.');
		expect(s).not.toMatch(/gate|approval|window/i);
	});

	it('2. EMPTY GATES, zero lag — the solo form is a grammatical sentence', () => {
		const s = verdictSentence([
			dev,
			env({
				label: 'prod',
				behind: 0,
				stuck: true,
				stuckKind: 'baking',
				stuckForMs: 26 * HOURS
			})
		]);
		expect(s).toBe('prod has been baking for 1 day.');
		expect(s!.match(/\./g)).toHaveLength(1);
	});

	it('2. EMPTY GATES, zero lag, no kind — still a sentence, not a fragment', () => {
		expect(verdictSentence([dev, env({ label: 'prod', behind: 0, stuck: true })])).toBe(
			'prod is not moving.'
		);
	});

	it('2. a real gate STILL wins over the observable wording', () => {
		// The fix must not have cost us the evidenced case: when a gate did
		// refuse, naming it is the whole point.
		const s = verdictSentence([
			dev,
			env({
				label: 'prod',
				behind: 19,
				blocked: true,
				stuck: true,
				stuckKind: 'baking',
				stuckForMs: 76 * HOURS,
				awaitingApprovalGates: ['hello-world-manual-approval']
			})
		]);
		expect(s).toBe('prod is 19 builds behind, waiting on a manual approval.');
	});

	it('3. Deploying outranks baking', () => {
		const s = verdictSentence([
			env({ label: 'staging', status: 'InProgress', behind: 1 }),
			env({ label: 'canary', status: 'Deploying', behind: 1 })
		]);
		expect(s).toBe('canary is deploying.');
	});

	it('3. baking when nothing is deploying', () => {
		const s = verdictSentence([dev, env({ label: 'staging', status: 'InProgress', behind: 1 })]);
		expect(s).toBe('staging is baking.');
	});

	it('4. converged, with the sha', () => {
		expect(verdictSentence([dev, staging, env({ label: 'prod' })])).toBe(
			'All 3 environments are on 9f10e49.'
		);
	});

	it('4. converged with a single environment does not say "All 1 environments"', () => {
		expect(verdictSentence([dev])).toBe('dev is on 9f10e49.');
	});

	it('4. does not claim a shared sha when the envs disagree about it', () => {
		const s = verdictSentence([dev, env({ label: 'prod', version: 'a44b210' })]);
		expect(s).toBe('All 2 environments are on the newest build.');
	});

	it('5. merely behind — lowest volume, no gate wording', () => {
		const s = verdictSentence([dev, staging, env({ label: 'prod', behind: 24, version: '205a312' })]);
		expect(s).toBe('prod is 24 builds behind.');
	});

	it('5. picks the furthest-behind env', () => {
		const s = verdictSentence([
			dev,
			env({ label: 'staging', behind: 2 }),
			env({ label: 'prod', behind: 7 })
		]);
		expect(s).toBe('prod is 7 builds behind.');
	});

	it('5. NEVER fabricates a number when the lag is unknowable', () => {
		const s = verdictSentence([dev, env({ label: 'prod', behind: null, version: '205a312' })]);
		expect(s).toBe('prod is behind.');
		expect(s).not.toMatch(/\d/);
	});

	it('5. a known lag outranks an unknowable one', () => {
		const s = verdictSentence([
			env({ label: 'staging', behind: null }),
			env({ label: 'prod', behind: 4 })
		]);
		expect(s).toBe('prod is 4 builds behind.');
	});

	it('always emits exactly one sentence', () => {
		const cases: VerdictEnv[][] = [
			[dev],
			[dev, staging],
			[env({ label: 'prod', status: 'Failed' })],
			[env({ label: 'prod', behind: 24, blocked: true, awaitingApprovalGates: ['g'] })],
			[env({ label: 'prod', status: 'Deploying', behind: 1 })],
			[dev, env({ label: 'prod', behind: null })],
			// the empty-gates shapes, which is where the fabricated cause was
			[dev, env({ label: 'prod', behind: 19, stuck: true })],
			[dev, env({ label: 'prod', behind: 0, stuck: true })],
			[dev, env({ label: 'prod', behind: null, stuck: true })],
			[
				dev,
				env({ label: 'prod', behind: 19, stuck: true, stuckKind: 'baking', stuckForMs: 9e6 })
			],
			[dev, env({ label: 'prod', behind: 0, stuck: true, stuckKind: 'behind', stuckForMs: 9e6 })]
		];
		for (const c of cases) {
			const s = verdictSentence(c);
			expect(s).toBeTruthy();
			expect(s!.match(/\./g)).toHaveLength(1);
			expect(s!.endsWith('.')).toBe(true);
			// No sentence may name a gate unless a gate list backed it.
			const named = c.some(
				(e) => e.awaitingApprovalGates.length > 0 || e.notPassingGates.length > 0
			);
			if (!named) expect(s).not.toMatch(/gate|approval|window/i);
		}
	});
});

describe('verdictSentence — diverged', () => {
	it('names the build and says nothing about lag', () => {
		const prod = env({ label: 'prod', diverged: true, behind: 19, version: '6f0aa12' });
		expect(verdictSentence([dev, staging, prod])).toBe(
			'prod is on 6f0aa12, which is not on the release line.'
		);
	});

	it('drops the sha rather than inventing one when the build is unknown', () => {
		const prod = env({ label: 'prod', diverged: true, version: null, behind: null });
		expect(verdictSentence([prod])).toBe(
			'prod is running a build that is not on the release line.'
		);
	});

	// A failed deploy is still the loudest fact: it happened, and it is the
	// thing an operator can act on first.
	it('yields to Failed', () => {
		const prod = env({ label: 'prod', diverged: true, version: '6f0aa12' });
		const bad = env({ label: 'staging', status: 'Failed' });
		expect(verdictSentence([bad, prod])).toBe("staging's last deploy failed.");
	});

	// The whole reason diverged outranks stuck: a stuck env's `−N` describes a
	// promotion that WOULD reach it; a diverged env's does not.
	it('outranks stuck, even when the stuck env has the larger lag', () => {
		const stuck = env({
			label: 'staging',
			behind: 40,
			stuck: true,
			stuckKind: 'baking',
			stuckForMs: 76 * 60 * 60 * 1000
		});
		const prod = env({ label: 'prod', diverged: true, behind: 2, version: '6f0aa12' });
		expect(verdictSentence([stuck, prod])).toBe(
			'prod is on 6f0aa12, which is not on the release line.'
		);
	});

	it('counts them rather than picking one when several are off the line', () => {
		const a = env({ label: 'us-west', diverged: true, version: 'aaa' });
		const b = env({ label: 'eu-central', diverged: true, version: 'bbb' });
		expect(verdictSentence([dev, a, b])).toBe(
			'2 environments (us-west, eu-central) are off the release line.'
		);
	});

	it('changes nothing when no env is diverged', () => {
		expect(verdictSentence([dev, staging])).toBe('All 2 environments are on 9f10e49.');
	});
});
