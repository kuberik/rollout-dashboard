import { it, expect } from 'vitest';
import { plumbOf, reposFromQuery, toggleRepo, STOPS } from './changes-plumb';
import { classifyChanges } from './changes-page';

for (const hs of ['incident', 'calm'] as const) {
	it(`${hs}: every in-flight change of mine sits in exactly one stop, at its product col`, () => {
		const pl = plumbOf(hs);
		const flying = classifyChanges(hs).mineP.filter((p) => p.state !== 'landed');
		expect(pl.total).toBe(flying.length);
		expect(pl.stops.map((s) => s.col)).toEqual([...STOPS]);
		for (const s of pl.stops) for (const r of s.rows) expect(flying.find((p) => p.c.key === r.key)!.col).toBe(s.col);
		expect(pl.chips.reduce((n, c) => n + c.count, 0)).toBe(flying.length);
	});
}
it('a repo filter narrows the line and the landed list, chips keep their counts', () => {
	const all = plumbOf('incident');
	const repo = all.chips[0].repo;
	const one = plumbOf('incident', [repo]);
	expect(one.total).toBe(all.chips[0].count);
	expect(one.chips).toEqual(all.chips);
	expect(one.landed.every((l) => l.repo === repo)).toBe(true);
	expect(plumbOf('incident', all.chips.map((c) => c.repo)).total).toBe(all.total);
});
it('platform-telemetry #20 is one row at its least advanced stop with the worst service named', () => {
	const r = plumbOf('incident').stops.flatMap((s) => s.rows).find((x) => x.repo === 'platform-telemetry')!;
	expect(r.services?.length).toBe(4);
	expect(r.col).toBe('dev');
	expect(r.worst).toBeTruthy();
});
it('?repo= round trip', () => {
	expect(reposFromQuery(new URLSearchParams('repo=a&repo=b,c&repo=zz'), ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
	expect(toggleRepo(['a'], 'b')).toEqual(['a', 'b']);
	expect(toggleRepo(['a', 'b'], 'a')).toEqual(['b']);
});
