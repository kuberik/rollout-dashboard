import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as D from './data';

/* r34 truth lane: dumps the derived facts to a JSON file for tools/truth.mjs and hand inspection.
 *
 * Dev tool, not an assertion: SKIPPED unless TRUTH_DUMP=1 (so CI and plain `vitest run` skip it).
 * Output path comes from TRUTH_DUMP_OUT (required when TRUTH_DUMP=1), e.g.
 *   TRUTH_DUMP=1 TRUTH_DUMP_OUT=./dump.json \
 *     pnpm exec vitest run src/lib/components/new/truth-dump.test.ts
 */
it.skipIf(process.env.TRUTH_DUMP !== '1')('dump', () => {
	const outPath = process.env.TRUTH_DUMP_OUT;
	if (!outPath) throw new Error('TRUTH_DUMP=1 requires TRUTH_DUMP_OUT=<path to dump.json>');
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
	writeFileSync(outPath, JSON.stringify(out, null, 1));
});
