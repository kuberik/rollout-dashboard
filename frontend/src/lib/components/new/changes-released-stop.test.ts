import { it, expect } from 'vitest';
import { classifyChanges, changesPage } from './changes-page';
import { plumbOf } from './changes-plumb';
import { source } from '$lib/components/home/sketch/home-data';
import { availableReleases, releaseCandidates } from '$lib/releases/registry.svelte';

/* Owner rule (2026-11-12): "If the release is not in the catalogue we don't show it, because a commit might not have a release at all."
   The leading "released" stop of the Changes trail (col 'merged') is only for a change whose commit a catalogue release carries. A commit with
   no release is not on that stop, not in the repo cards' "released" cell, and not in their counts. */
type Fx = { repo: string; mergedAt: string; mergeCommitSha: string };
const catalogueRevisions = (): string[] =>
	(source().rollouts as unknown[])
		.flatMap((r) => [...(availableReleases(r as never) ?? []), ...(releaseCandidates(r as never) ?? [])] as { revision?: string }[])
		.map((x) => String(x.revision ?? ''));
const shaOf = (repo: string, mergedAt: string): string =>
	(source().changes as unknown as Fx[]).find((c) => c.repo === repo && c.mergedAt === mergedAt)?.mergeCommitSha.slice(0, 7) ?? '';

for (const hs of ['incident', 'calm'] as const) {
	it(`${hs}: nothing sits on the released stop unless a catalogue release carries its commit`, () => {
		const revs = catalogueRevisions();
		const { mineP, teamP } = classifyChanges(hs);
		const onStop = [...mineP, ...teamP].filter((p) => p.col === 'merged');
		expect(onStop.length).toBeGreaterThan(0);
		for (const p of onStop) expect(revs.some((r) => r.startsWith(shaOf(p.c.repo, p.c.mergedAt))), `${p.c.repo} ${p.ref}`).toBe(true);
	});
	it(`${hs}: a commit with no release in the catalogue is on no released stop, in no released cell`, () => {
		const revs = catalogueRevisions();
		const noRelease = (source().changes as unknown as Fx[]).filter((c) => !revs.some((r) => r.startsWith(c.mergeCommitSha.slice(0, 7))));
		expect(noRelease.length).toBeGreaterThan(0);
		const dark = new Set(noRelease.map((c) => c.repo + c.mergedAt));
		const { mineP, teamP } = classifyChanges(hs);
		const all = [...mineP, ...teamP];
		/* a no-release commit the page does show is placed by ancestry at a real tier (a later build carries it), never on the released stop */
		for (const p of all) if (dark.has(p.c.repo + p.c.mergedAt)) expect(p.col, `${p.c.repo} ${p.ref}`).not.toBe('merged');
		const stop = plumbOf(hs).stops.find((s) => s.col === 'merged')!;
		const rows = new Set(stop.rows.map((r) => r.key));
		for (const p of all) if (dark.has(p.c.repo + p.c.mergedAt)) expect(rows.has(p.c.key)).toBe(false);
		/* the repo cards draw a "released" cell only for a repo that has a change on that stop */
		const onStop = all.filter((p) => p.col === 'merged' && p.state !== 'landed');
		for (const g of [...changesPage(hs).mine, ...changesPage(hs).team]) {
			if (g.card.cells.some((c) => c.label === 'released')) expect(onStop.some((p) => g.repo.endsWith(p.c.repo)), g.repo).toBe(true);
		}
	});
}
