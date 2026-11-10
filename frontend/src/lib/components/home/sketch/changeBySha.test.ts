import { it, expect } from 'vitest';
import { changeBySha, source } from './home-data';
it('a multi-service repo is found from any of its apps (not only an app named after the repo)', () => {
	const fx = source().changes as unknown as { repo: string; mergeCommitSha: string; htmlUrl: string }[];
	const c = fx.find((x) => x.repo === 'platform-telemetry' && x.htmlUrl.endsWith('/20'))!;
	const sha = c.mergeCommitSha.slice(0, 7);
	expect(changeBySha('platform-telemetry', sha)?.ref).toBe('#20');
	expect(changeBySha('telemetry-indexer', sha)?.ref).toBe('#20');
	expect(changeBySha('telemetry-worker', sha)?.ref).toBe('#20');
	expect(changeBySha('telemetry-indexer', 'deadbee')).toBeNull();
});
