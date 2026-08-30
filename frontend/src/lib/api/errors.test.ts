import { describe, it, expect } from 'vitest';
import {
	ApiError,
	isRetryable,
	queryRetry,
	pollWhenHealthy,
	errorHeadline,
	errorConsequence,
	errorDetail,
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

	it("keeps the server's own sentence verbatim", () => {
		const detail = 'failed to get rollout: rollouts.kuberik.com "does-not-exist" not found';
		expect(errorDetail(err(500, detail))).toBe(detail);
	});

	it('falls back to the status when the server sent no sentence', () => {
		expect(errorDetail(err(502))).toBe('HTTP 502');
	});

	it('says the dashboard keeps checking, so a 5xx state is not a dead end', () => {
		expect(errorConsequence(err(503))).toContain('keeps checking');
	});
});
