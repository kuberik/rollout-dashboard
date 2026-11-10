import { describe, test, expect } from 'vitest';
import { DEPLOY_PARAM, deployKey, findDeployIndex, autoExpandFailedLiveIndex } from './history-deeplink';

/**
 * The cases here are the live `hello-world-prod/hello-world-app` history read
 * off the cluster on 2026-09-02 — five deploys, two of them rollbacks — plus
 * the one shape that list does NOT contain and that the resolver has to get
 * right anyway: the same revision deployed twice.
 */
const entry = (revision?: string, version?: string, tag = 't') => ({
	version: { revision, version, tag }
});

const LIVE = [
	entry('064b655b51595b593262fb780e2d8121e7348f84', '064b655'),
	entry('991829b6ab3bdb0100ac0a44d8867460732159f7', '991829b'),
	entry('0afab6f35627254181e41053c51660f26a8ccee2', '0afab6f'),
	entry('51b976affa37148db7ee8ec77f80ef28cc58cb23', '51b976a'),
	entry('aa17645838c1f0261e32ab94c43b2d0bdcd25a22', 'aa17645')
];

describe('deployKey', () => {
	test('is the twelve-character revision slug, not the seven the row prints', () => {
		expect(deployKey(LIVE[0])).toBe('064b655b5159');
		expect(deployKey(LIVE[0])).toHaveLength(12);
	});

	test('falls back to the build name when the entry carries no commit', () => {
		expect(deployKey(entry(undefined, '1.66.0-66'))).toBe('1.66.0-66');
	});

	test('names nothing rather than linking to nowhere', () => {
		expect(deployKey(null)).toBeNull();
		expect(deployKey({ version: null })).toBeNull();
		expect(deployKey({ version: { tag: '' } })).toBeNull();
	});
});

describe('findDeployIndex', () => {
	test('resolves the rollup’s own head to the latest entry', () => {
		expect(findDeployIndex(LIVE, deployKey(LIVE[0]))).toBe(0);
	});

	test('resolves every entry in the live history to itself', () => {
		LIVE.forEach((e, i) => expect(findDeployIndex(LIVE, deployKey(e))).toBe(i));
	});

	test('accepts a short display sha and a full 40-character one', () => {
		expect(findDeployIndex(LIVE, '51b976a')).toBe(3);
		expect(findDeployIndex(LIVE, '51b976affa37148db7ee8ec77f80ef28cc58cb23')).toBe(3);
	});

	test('is case-insensitive and tolerates whitespace from a pasted URL', () => {
		expect(findDeployIndex(LIVE, ' 064B655B5159 ')).toBe(0);
	});

	// ⚠️ THE AMBIGUOUS CASE. A rollback re-deploys a build already in the list.
	test('a revision deployed twice resolves to the NEWEST of the two', () => {
		const withRollback = [entry('aa17645838c1', 'aa17645'), ...LIVE];
		expect(findDeployIndex(withRollback, 'aa17645838c1')).toBe(0);
	});

	test('an unknown or empty key resolves to nothing', () => {
		expect(findDeployIndex(LIVE, 'deadbeef')).toBe(-1);
		expect(findDeployIndex(LIVE, '')).toBe(-1);
		expect(findDeployIndex(LIVE, null)).toBe(-1);
		expect(findDeployIndex([], '064b655b5159')).toBe(-1);
		expect(findDeployIndex(null, '064b655b5159')).toBe(-1);
	});

	test('the parameter name is stable, because it ships in URLs people paste', () => {
		expect(DEPLOY_PARAM).toBe('deploy');
	});
});

/**
 * (Logs AD round 9, item D1, binding, 2026-10-12) "History must open at
 * scroll 0. The rule 'open the failed live entry expanded by default'
 * means expanded in place, never scrolled to." The page never calls
 * `revealEntry` (which scrolls) for this case — it mutates its own
 * `expandedIdx` directly, keyed on exactly this function's return value.
 * `window.scrollY` is not a meaningful assertion in jsdom (there is no
 * layout/scroll engine under it — `scrollIntoView` is an unimplemented
 * no-op there and `scrollY` reads 0 unconditionally regardless of what the
 * code does), so this tests the actual DECISION the page's own `$effect`
 * is built on instead: WHICH index it silently expands, and that an
 * explicit `?deploy=` always defers to the normal, scrolling path
 * (`revealEntry`, exercised separately via `findDeployIndex` above) rather
 * than this one.
 */
describe('autoExpandFailedLiveIndex', () => {
	const failedLive = [{ bakeStatus: 'Failed' }, { bakeStatus: 'Succeeded' }];
	const healthyLive = [{ bakeStatus: 'Succeeded' }, { bakeStatus: 'Succeeded' }];

	test('the live entry failed, no ?deploy= param: expands index 0 (the auto-expand path — never scrolled to)', () => {
		expect(autoExpandFailedLiveIndex(failedLive, false)).toBe(0);
	});

	test('a ?deploy= param is present: defers entirely, even though the live entry failed (the deep link keeps its own scroll)', () => {
		expect(autoExpandFailedLiveIndex(failedLive, true)).toBeNull();
	});

	test('the live entry is healthy: nothing to auto-expand', () => {
		expect(autoExpandFailedLiveIndex(healthyLive, false)).toBeNull();
	});

	test('no history yet (direct load, query still in flight): nothing to auto-expand', () => {
		expect(autoExpandFailedLiveIndex([], false)).toBeNull();
		expect(autoExpandFailedLiveIndex(null, false)).toBeNull();
		expect(autoExpandFailedLiveIndex(undefined, false)).toBeNull();
	});

	test('a failed PAST entry (not the live one) does not auto-expand anything', () => {
		const resolved = [{ bakeStatus: 'Succeeded' }, { bakeStatus: 'Failed' }];
		expect(autoExpandFailedLiveIndex(resolved, false)).toBeNull();
	});
});
