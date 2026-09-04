import { describe, it, expect, vi, beforeEach } from 'vitest';

const isEventStreamHealthy = vi.fn(() => false);
vi.mock('./events', () => ({ isEventStreamHealthy: () => isEventStreamHealthy() }));

import {
	ApiError,
	isRetryable,
	queryRetry,
	pollWhenHealthy,
	staleTimeWhenHealthy,
	errorHeadline,
	errorConsequence,
	errorFacts,
	MAX_RETRIES,
	RECOVERY_POLL_MS
} from './errors';

const err = (status: number, detail = '') =>
	new ApiError(status, 'boom', detail, '/api/rollouts/x/y');

describe('isRetryable — the policy, stated as tests', () => {
	it('never retries a 404: the answer cannot change by asking again', () => {
		expect(isRetryable(err(404))).toBe(false);
	});

	it('never retries a 401 — it needs a PERSON, and a loop hides that', () => {
		expect(isRetryable(err(401))).toBe(false);
	});

	it('never retries a 403', () => {
		expect(isRetryable(err(403))).toBe(false);
	});

	it('retries 408 and 429, the two 4xx that name a timing problem', () => {
		expect(isRetryable(err(408))).toBe(true);
		expect(isRetryable(err(429))).toBe(true);
	});

	it('retries a plain 5xx: a controller restart is real and self-healing', () => {
		expect(isRetryable(err(500, 'connection refused'))).toBe(true);
		expect(isRetryable(err(503))).toBe(true);
	});

	/**
	 * THE LIVE CASE. `GET /api/rollouts/prod/does-not-exist` answers **500**
	 * with `details: 'failed to get rollout: rollouts.kuberik.com
	 * "does-not-exist" not found'`. Retrying that fifteen times in 35 seconds
	 * is what produced the eternal skeleton.
	 */
	it('does not retry a 5xx whose own words say the object is not found', () => {
		const live = err(500, 'failed to get rollout: rollouts.kuberik.com "does-not-exist" not found');
		expect(live.isMissing).toBe(true);
		expect(isRetryable(live)).toBe(false);
	});

	it('retries when there was no response at all (offline, dropped tunnel)', () => {
		expect(isRetryable(err(0))).toBe(true);
	});

	it('retries an error of unknown shape rather than giving up on it', () => {
		expect(isRetryable(new Error('who knows'))).toBe(true);
	});
});

describe('queryRetry — bounded, even for the retryable ones', () => {
	it('stops after MAX_RETRIES on a 5xx', () => {
		expect(queryRetry(0, err(500))).toBe(true);
		expect(queryRetry(MAX_RETRIES - 1, err(500))).toBe(true);
		expect(queryRetry(MAX_RETRIES, err(500))).toBe(false);
	});

	it('stops immediately on a 404', () => {
		expect(queryRetry(0, err(404))).toBe(false);
	});
});

describe('pollWhenHealthy — a dead URL must stop costing requests', () => {
	const poll = pollWhenHealthy(5000);

	it('keeps the caller interval while the query is healthy', () => {
		expect(poll({ state: { status: 'success', error: null } })).toBe(5000);
	});

	it('stops entirely once the failure is one that cannot heal', () => {
		expect(poll({ state: { status: 'error', error: err(404) } })).toBe(false);
		expect(poll({ state: { status: 'error', error: err(401) } })).toBe(false);
	});

	it('backs off instead of stopping when the failure might heal', () => {
		expect(poll({ state: { status: 'error', error: err(503) } })).toBe(RECOVERY_POLL_MS);
	});
});

describe('pollWhenHealthy(ms, streamedMs) — PERF-2026-09-04 §C.6/C.7 stream-aware cadence', () => {
	beforeEach(() => {
		isEventStreamHealthy.mockReset();
	});

	it('one-argument callers are byte-identical to before: the stream is never consulted', () => {
		isEventStreamHealthy.mockReturnValue(true);
		const poll = pollWhenHealthy(5000);
		expect(poll({ state: { status: 'success', error: null } })).toBe(5000);
		expect(isEventStreamHealthy).not.toHaveBeenCalled();
	});

	it('with a healthy stream, returns the slower streamedMs instead of the fallback', () => {
		isEventStreamHealthy.mockReturnValue(true);
		const poll = pollWhenHealthy(5000, 60000);
		expect(poll({ state: { status: 'success', error: null } })).toBe(60000);
	});

	it('with the stream down, returns exactly the old fallback cadence', () => {
		isEventStreamHealthy.mockReturnValue(false);
		const poll = pollWhenHealthy(5000, 60000);
		expect(poll({ state: { status: 'success', error: null } })).toBe(5000);
	});

	it('an error still wins over stream health — never polls fast into a 404', () => {
		isEventStreamHealthy.mockReturnValue(true);
		const poll = pollWhenHealthy(5000, 60000);
		expect(poll({ state: { status: 'error', error: err(404) } })).toBe(false);
		expect(poll({ state: { status: 'error', error: err(503) } })).toBe(RECOVERY_POLL_MS);
	});
});

describe('staleTimeWhenHealthy — the staleTime half of the same rule', () => {
	beforeEach(() => {
		isEventStreamHealthy.mockReset();
	});

	it('healthy stream → the slower streamed staleTime', () => {
		isEventStreamHealthy.mockReturnValue(true);
		expect(staleTimeWhenHealthy(1000, 30000)()).toBe(30000);
	});

	it('stream down → today’s staleTime, unchanged', () => {
		isEventStreamHealthy.mockReturnValue(false);
		expect(staleTimeWhenHealthy(1000, 30000)()).toBe(1000);
	});
});

describe('the words a reader gets', () => {
	it('names the missing thing, not the status code', () => {
		expect(errorHeadline(err(404), 'this rollout')).toBe('This rollout does not exist');
	});

	it('says the session expired rather than showing a blank shell', () => {
		expect(errorHeadline(err(401))).toBe('Your session has expired');
		expect(errorConsequence(err(401))).toContain('Sign in again');
	});

	it('distinguishes 403 from 401 — one needs a login, one needs a grant', () => {
		expect(errorHeadline(err(403))).toBe("You don't have access to this");
		expect(errorConsequence(err(403))).toContain('access');
	});

	it("keeps the server's own sentence verbatim, in its own field", () => {
		const detail = 'failed to get rollout: rollouts.kuberik.com "does-not-exist" not found';
		// ⭐ FIELDS, NOT A SENTENCE. (2026-09-02) It was one string,
		// `/api/rollouts/x/y — <detail>`; the address and the server's words are
		// two different kinds of thing and the em dash was doing a `<dt>`'s job.
		// The CLAIM is unchanged: verbatim, and behind the address queried.
		expect(errorFacts(err(500, detail))).toEqual([
			{ label: 'Address', value: '/api/rollouts/x/y', handle: true },
			{ label: 'Status', value: 'HTTP 500', handle: true },
			{ label: 'Server said', value: detail }
		]);
	});

	/**
	 * ⛔ IT USED TO SAY `HTTP 502`, WHICH IS INDISTINGUISHABLE FROM A SERVER
	 * SENTENCE THAT HAPPENS TO READ "HTTP 502". The standing rule on this branch
	 * is that an absent record is not an observation: when the server sent no
	 * words, the UI must SAY it sent none rather than dress the status code up
	 * as an explanation.
	 */
	it('says outright that the server sent nothing, instead of dressing up the code', () => {
		const facts = errorFacts(err(502));
		const at = (label: string) => facts.find((f) => f.label === label)?.value;
		expect(at('Address')).toBe('/api/rollouts/x/y');
		expect(at('Status')).toBe('HTTP 502');
		// ⛔ THE ROW IS NOT EMPTY AND IT IS NOT THE STATUS CODE. An absent record
		// is not an observation: when the server sent no words, the field SAYS so.
		expect(at('Server said')).toBe('nothing');
	});

	it('says the dashboard keeps checking, so a 5xx state is not a dead end', () => {
		expect(errorConsequence(err(503))).toContain('keeps checking');
	});
});

/**
 * ⭐ FINDING 2, 2026-08-31, PINNED AS TESTS.
 *
 * A UX critic scaled `deploy/rollout-dashboard` to 0 so `/api/rollouts`
 * answered 503, then loaded every page. What came back was a title and, at
 * best, a 12px line reading `Failed to load: Request failed (503)`. The
 * critic's sentence is the requirement: *"At 3am a blank Rollouts page reads
 * as 'the cluster has no rollouts'"* — the product inventing an all-clear out
 * of a failure.
 *
 * These assert the WORDS, because the words are the fix. A failure that
 * renders as a skeleton, or as a status code, is exactly the class that comes
 * back the moment nobody is looking.
 */
describe('an outage must never be readable as an empty fleet', () => {
	const outage = err(503);

	it('names the unreachable server, not the page that noticed', () => {
		expect(errorHeadline(outage, 'the rollout list')).toBe('Cannot reach the dashboard server');
		expect(errorHeadline(err(0), 'the rollout list')).toBe('Cannot reach the dashboard server');
		expect(errorHeadline(err(504))).toBe('Cannot reach the dashboard server');
	});

	it('distinguishes a server that answered badly from one that did not answer', () => {
		expect(errorHeadline(err(500, 'index out of range'))).toBe(
			'The dashboard server could not answer'
		);
	});

	it('states in words that the emptiness is not a reading of the cluster', () => {
		const c = errorConsequence(outage);
		expect(c).toContain('failed request');
		expect(c).toContain('not an empty result');
		expect(c).toMatch(/nothing on this page is a reading of your cluster/i);
	});

	it('never claims a recovery poll for a failure the policy will not retry', () => {
		// 409 is an answer, not an accident — `pollWhenHealthy` stops entirely,
		// so the copy must not promise the page will fill itself in.
		expect(isRetryable(err(409))).toBe(false);
		expect(errorConsequence(err(409))).not.toContain('keeps checking');
		expect(errorConsequence(err(409))).toContain('failed request');
	});

	it('classifies 0/502/503/504 as unreachable and 500 as answered-badly', () => {
		expect(err(0).isUnreachable).toBe(true);
		expect(err(502).isUnreachable).toBe(true);
		expect(err(503).isUnreachable).toBe(true);
		expect(err(504).isUnreachable).toBe(true);
		expect(err(500).isUnreachable).toBe(false);
	});

	it('a 503 is retried and then polled, so the page heals without a reload', () => {
		expect(isRetryable(outage)).toBe(true);
		expect(queryRetry(MAX_RETRIES, outage)).toBe(false); // it does STOP retrying…
		expect(pollWhenHealthy(5000)({ state: { status: 'error', error: outage } })).toBe(
			RECOVERY_POLL_MS
		); // …and then keeps checking, which is what "heals itself" means
	});
});
