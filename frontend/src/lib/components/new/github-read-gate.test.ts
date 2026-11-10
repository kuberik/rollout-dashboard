import { describe, it, expect, vi } from 'vitest';
import { githubJson } from './github-read.svelte';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { githubStatusStarted, recordGithubStatus } from '$lib/api/github-gate.svelte';

describe('githubJson with the GitHub gate (QA2 #4 follow-up)', () => {
	it('a cached answer survives a held gate; only new asks are stopped', async () => {
		installLiveSource({ rollouts: [] } as never);
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ n: 1 }), { status: 200 })));
		expect(githubJson('/api/x')).toBeNull();
		await vi.waitFor(() => expect(githubJson('/api/x')).toEqual({ n: 1 }));
		githubStatusStarted(); /* the status refetches: gate held */
		expect(githubJson('/api/x')).toEqual({ n: 1 });
		expect(githubJson('/api/y')).toBeNull();
		expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
		recordGithubStatus({ configured: true, connected: true });
		installLiveSource(null);
	});
});
