import { describe, it, expect, vi } from 'vitest';
/* the release catalogue, oldest first: c3 is the newest build (the one that failed upstream and is held by no place) */
vi.mock('../data', async (orig) => ({
	...(await orig<typeof import('../data')>()),
	streamBuilds: () => ['c0', 'c1', 'c2', 'c3'],
	/* the most recent DEPLOY is a rollback to c1 */
	deployedHistory: (href: string) => (href === '/x/prod' ? [{ build: 'c1', title: null, author: null, at: '2026-11-10T10:38:00Z' }] : [{ build: 'c0', title: null, author: null, at: '2026-11-10T09:00:00Z' }])
}));
import { ledgerOf, stopWord } from './app-model';

const place = (name: string, deployed: string) => ({ wave: null, env: name, label: name, place: name, tier: 'staging', state: 'healthy', href: `/x/${name}`, deployedBuild: deployed, heldBuilds: [] });

describe('Newest is the newest build of the release catalogue, never the latest deploy', () => {
	it('a rollback to c1 does not make c1 "Newest"; the catalogue newest c3 does', () => {
		const stops = ledgerOf([place('prod', 'c1'), place('stg', 'c0')] as never);
		const word = (b: string) => stopWord(stops.find((s) => s.build === b)!);
		expect(word('c3')).toBe('Newest');
		expect(word('c1')).not.toBe('Newest');
		expect(word('c1')).toBe('1 build behind');
	});
});
