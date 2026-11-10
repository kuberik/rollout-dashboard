import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as D from './data';

/* r34 truth lane: dumps the derived facts to .work/home-r34/truth/dump.json for tools/truth.mjs and hand inspection. */
it('dump', () => {
	const out: Record<string, unknown> = {};
	for (const s of ['incident', 'calm', 'quiet'] as const) {
		const R = D.rollouts(s);
		out[s] = {
			rows: R.rows.map((r) => ({ key: r.key, app: r.app, tier: r.tier, where: r.where, regions: r.regions, state: r.state, group: r.group, word: r.word, change: r.change, version: r.version, since: r.since, href: r.href, cause: r.cause, pipeline: r.pipeline })),
			changes: D.changes(s).items.map((c) => ({ ref: c.ref, title: c.title, mine: c.mine, group: c.group, fact: c.fact, where: c.where, reach: c.reach, at: c.at, since: c.since, href: c.href, apps: c.apps, rolledBack: c.rolledBack })),
			regions: D.environments(s).regions,
			apps: D.apps(s).items.map((a) => ({ app: a.app, group: a.group, fact: a.fact, href: a.href }))
		};
	}
	writeFileSync('/home/luka/projects/kuberik/.work/home-r34/truth/dump.json', JSON.stringify(out, null, 1));
});
