import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { failurePhrase } from '../utils';
import { activityVerb } from './activity-verb';
import { activityKindOf } from './activity-kind';
import { groupActivityEntries, type GroupableEntry } from './activity-groups';

/**
 * ⭐ ONE FAILURE PHRASE, EVERY SURFACE. (qa11 B4, 2026-10-11.) `failurePhrase`
 * (`lib/utils.ts`) is the only place "failed to deploy" / "failed its health
 * check" may be spelled outside a test or the message catalogue — this file
 * proves every caller agrees with it, and the guard test below proves
 * nothing else in `frontend/src` spells the words itself.
 */
describe('failurePhrase is the one source of the two failure verbs', () => {
	it('a health-check message reads "failed its health check"', () => {
		expect(failurePhrase('HighErrorRate firing')).toBe('failed its health check');
		expect(failurePhrase('liveness probe failed')).toBe('failed its health check');
	});

	it('a genuine deploy failure (no health-check cause) reads "failed to deploy"', () => {
		expect(failurePhrase('image pull backoff')).toBe('failed to deploy');
		expect(failurePhrase(null)).toBe('failed to deploy');
		expect(failurePhrase(undefined)).toBe('failed to deploy');
	});

	it('activityVerb for failed/failedHealthCheck matches failurePhrase exactly', () => {
		expect(activityVerb('failed').appVerb).toBe(failurePhrase(null));
		expect(activityVerb('failedHealthCheck').appVerb).toBe(failurePhrase('health check'));
	});
});

/**
 * ⭐ THE ACTUAL BUG: A GROUPED `/activity` ROW LOST THE MESSAGE. `toGroupable`
 * /`groupActivityEntries` used to carry `bakeStatus` onto the group but not
 * `bakeStatusMessage`, so `activityKindForGroup` always classified with
 * `undefined` → `categorizeFailure(undefined)` → never `'healthcheck'` →
 * always the generic phrase, even for an incident whose Needs-you row (and a
 * SOLO activity row for the same event) correctly named the health check.
 * `activity-groups.ts` now carries `worstBakeStatusMessage`; this proves a
 * one-member "group" (the common case: nothing else deployed in that
 * minute) still resolves to `failedHealthCheck`.
 */
describe('a grouped /activity row classifies the same as a solo row for the identical event', () => {
	function entry(overrides: Partial<GroupableEntry> = {}): GroupableEntry {
		return {
			key: 'k1',
			rolloutName: 'checkout-worker',
			rolloutNamespace: 'checkout-worker-staging',
			displayName: 'checkout-worker',
			envLabel: 'staging',
			envKey: 'staging',
			version: 'v1',
			previousVersion: 'v0',
			timestamp: '2026-10-11T00:00:00Z',
			href: '/rollouts/x',
			bakeStatus: 'Failed',
			bakeStatusMessage: 'HighErrorRate firing for checkout-worker',
			...overrides
		};
	}

	it('a single-member group carries the message onto worstBakeStatusMessage', () => {
		const [group] = groupActivityEntries([entry()]);
		expect(group.worstBakeStatus).toBe('Failed');
		expect(group.worstBakeStatusMessage).toBe('HighErrorRate firing for checkout-worker');

		const kind = activityKindOf({
			bakeStatus: group.worstBakeStatus,
			bakeStatusMessage: group.worstBakeStatusMessage,
			isRollback: false,
			actorKind: 'controller',
			envRank: 2,
			firstEnvRank: 1
		});
		expect(kind).toBe('failedHealthCheck');
		expect(activityVerb(kind).appVerb).toBe('failed its health check');
	});

	it('a genuine deploy failure in a group still reads the generic phrase', () => {
		const [group] = groupActivityEntries([
			entry({ bakeStatusMessage: 'image pull backoff: manifest unknown' })
		]);
		const kind = activityKindOf({
			bakeStatus: group.worstBakeStatus,
			bakeStatusMessage: group.worstBakeStatusMessage,
			isRollback: false,
			actorKind: 'controller',
			envRank: 2,
			firstEnvRank: 1
		});
		expect(kind).toBe('failed');
		expect(activityVerb(kind).appVerb).toBe('failed to deploy');
	});
});

/**
 * ⛔ GUARD: THE TWO LITERAL PHRASES MAY ONLY BE SPELLED IN THE PHRASE MODULE.
 * Any other occurrence in `frontend/src` is a second dialect waiting to
 * drift from `categorizeFailure` the way `/activity`'s grouped rows and
 * `/environments`/`/envs/[name]`'s banners did (qa11 B4). Tests and the
 * generated message catalogue are allowed to quote the words; app code is
 * not.
 */
describe('guard: the failure phrases are spelled nowhere but the phrase module', () => {
	const PHRASES = ['failed to deploy', 'failed its health check'];
	// `utils.ts` is the phrase module itself. `axis.ts` is the message-scan
	// registry (`lib/messages`) that RECOGNIZES these words in already-
	// rendered text for the catalogue/accessibility audit — it consumes the
	// phrase, it does not author a second place that spells it to a user.
	const ALLOWED_FILES = new Set(['utils.ts', 'axis.ts']);

	function walk(dir: string, out: string[] = []): string[] {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			const st = statSync(full);
			if (st.isDirectory()) {
				walk(full, out);
			} else if (/\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name)) {
				out.push(full);
			}
		}
		return out;
	}

	// Strips `//...` line comments and `/* ... */` block comments so a doc
	// comment that MENTIONS the phrase (explaining the bug this file fixes)
	// doesn't trip the guard — only code that actually renders the words
	// should.
	function stripComments(text: string): string {
		return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
	}

	it('no literal failure phrase outside utils.ts, axis.ts, a test, or the catalogue', () => {
		const srcDir = join(__dirname, '..', '..');
		const offenders: string[] = [];
		for (const file of walk(srcDir)) {
			const base = file.split('/').pop()!;
			if (ALLOWED_FILES.has(base)) continue;
			if (base === 'catalogue.txt') continue;
			const text = stripComments(readFileSync(file, 'utf8'));
			for (const phrase of PHRASES) {
				if (text.includes(phrase)) {
					offenders.push(`${file}: "${phrase}"`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
