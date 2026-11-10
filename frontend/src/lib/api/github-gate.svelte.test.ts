import { describe, it, expect, beforeEach } from 'vitest';
import { commitsQueryOptions } from './github';
import { commitQueryOptions } from './commit';
import { recordGithubStatus } from './github-gate.svelte';

const range = { namespace: 'ns', name: 'app', base: 'a'.repeat(40), head: 'b'.repeat(40) };
const one = { owner: 'o', repo: 'r', sha: 'c'.repeat(40) };

describe('GitHub gate (QA2 #4): do not ask GitHub while it is known not connected', () => {
	beforeEach(() => recordGithubStatus(undefined));
	it('asks while status is unknown', () => {
		expect(commitsQueryOptions(range).enabled).toBe(true);
		expect(commitQueryOptions(one).enabled).toBe(true);
	});
	it('does not ask once not connected', () => {
		recordGithubStatus({ configured: true, connected: false });
		expect(commitsQueryOptions(range).enabled).toBe(false);
		expect(commitQueryOptions(one).enabled).toBe(false);
	});
	it('an unreachable status call (configured null) never blocks', () => {
		recordGithubStatus({ configured: null, connected: false });
		expect(commitsQueryOptions(range).enabled).toBe(true);
	});
	it('connecting re-enables', () => {
		recordGithubStatus({ configured: true, connected: false });
		recordGithubStatus({ configured: true, connected: true });
		expect(commitsQueryOptions(range).enabled).toBe(true);
	});
});

import { githubAskHeld, githubStatusStarted } from './github-gate.svelte';
describe('hold while the status answer is on its way', () => {
	it('holds asks until recorded', () => {
		recordGithubStatus(undefined);
		githubStatusStarted();
		expect(commitsQueryOptions(range).enabled).toBe(false);
		recordGithubStatus({ configured: true, connected: true });
		expect(githubAskHeld()).toBe(false);
		expect(commitsQueryOptions(range).enabled).toBe(true);
	});
});
