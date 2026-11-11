/**
 * `MOCK_PARTIAL=slow|unreachable` — the hub FAILS SOFT with one cluster's LAST-KNOWN data still merged (`stale: true`, `lastSeen`),
 * once per `reason` the server types (see ClusterError in api/rollouts.ts). The default (no flag) serves no errors, so every scenario's
 * other facts are unchanged. The detail strings are the server's own plain sentences.
 */
import type { ClusterError } from '$lib/api/rollouts';

export type StaleMockMode = 'slow' | 'unreachable';

export function staleMockMode(v: string | undefined | null): StaleMockMode | null {
	return v === 'slow' || v === 'unreachable' ? v : null;
}

export function staleClusterErrors(mode: StaleMockMode | null | undefined, now: Date = new Date()): ClusterError[] {
	if (!mode) return [];
	const lastSeen = new Date(now.getTime() - 47 * 60_000).toISOString();
	return [
		{
			name: 'prod',
			url: 'https://kuberik-prod.example.com',
			stale: true,
			lastSeen,
			reason: mode,
			error:
				mode === 'slow'
					? 'took too long to answer, so its last known state is shown'
					: 'Get "https://kuberik-prod.example.com/api/rollouts": dial tcp 10.96.0.31:443: i/o timeout'
		}
	];
}
