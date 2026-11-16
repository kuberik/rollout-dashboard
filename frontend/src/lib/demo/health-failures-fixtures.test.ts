import { describe, it, expect, beforeAll } from 'vitest';
import { respond } from './respond';
import { resetDemoState } from './state';
import { install } from './health-failures-fixtures';

/**
 * What the opt-in health-failures scenario must carry so every surface that draws the recovered mark has a recovered place to draw:
 * a failed place with newer builds held behind it (the app page's Holding card), and a failed change the viewer wrote (the Changes
 * page's Your-changes line). Each fact is the reason one of those surfaces shows a ring in the mock.
 */
beforeAll(() => { install(true); resetDemoState('calm'); });

type R = { metadata: { name: string; namespace: string }; status?: { history?: { version?: { tag?: string } }[] } };
const rollouts = () => (JSON.parse(respond('GET', '/api/rollouts').body ?? '{}').rollouts.items as R[]);
const headTag = (app: string, ns: string) => rollouts().find((r) => r.metadata.name === app && r.metadata.namespace === ns)?.status?.history?.[0]?.version?.tag;

describe('health-failures fixtures: the recovered surfaces', () => {
	it('search-indexer: dev and staging run a build newer than the failed prod head, so prod holds it', () => {
		const prod = headTag('search-indexer', 'search-indexer-prod-default');
		expect(headTag('search-indexer', 'search-indexer-dev')).toBe('hf5-05');
		expect(headTag('search-indexer', 'search-indexer-staging')).toBe('hf5-05');
		expect(prod).toBe('hf5-04');
	});
	it('the other cases stay one build deep: dev, staging and prod on the same build', () => {
		expect(headTag('catalog-api', 'catalog-api-dev')).toBe(headTag('catalog-api', 'catalog-api-prod-default'));
	});
	it("catalog-api's failed build is the viewer's own change", () => {
		const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!) as { changes: { author: string; repo?: string; title?: string; sha?: string }[] };
		expect(gh.changes.some((c) => c.author === 'danielreed' && JSON.stringify(c).includes('catalog-api'))).toBe(true);
	});
});
