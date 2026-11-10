import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stepLabel } from '$lib/components/NextStep.svelte';

/**
 * ⛔ qa11b (2026-10-11) — AN APPROVAL HOLD NEVER OPENS THE DEPLOY DIALOG.
 *
 * The dashboard has no approval action: an approval is a hand-authored
 * RolloutGate's `allowedVersions`, and no API route writes one. Every
 * "Approve" control used to open ChangeVersionModal on the waiting build,
 * which deploys PAST the rule — an override dressed as an approval. The
 * stopgap: every approval control is a LINK to the rollout's Gates tab,
 * read through §3.19's review form ("Review approval in <env>").
 *
 * This guard scans the source so a FUTURE caller cannot wire an
 * approval-hold branch back to the dialog. A marker line opens a branch
 * that is about an approval hold; its block (every following line indented
 * deeper than the marker) must not reach any deploy-dialog opener.
 */

const SRC = join(__dirname, '..');

/** Lines that open a branch about an approval hold. */
const MARKERS = [
	/kind === 'approve'/,
	/isHeldByApproval\(/,
	/\bheldByApproval\b/,
	/story\.person\.length > 0/,
	/stepLabel\('approve'/
];

/** Anything that opens (or mounts) the deploy / change-version dialog. */
const OPENERS =
	/\bopenVersion\(|\bopenPromote\(|\bopenChangeVersion\(|<ChangeVersionModal\b|<ChangeVersionFlow\b|showChangeVersionModal\s*=\s*true|versionModalOpen\s*=\s*true/;

function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			if (name === 'node_modules' || name === 'demo' || name === 'testing') continue;
			sourceFiles(p, out);
		} else if (/\.(svelte|ts)$/.test(name) && !/\.test\.ts$/.test(name)) {
			out.push(p);
		}
	}
	return out;
}

/**
 * `kind === 'held'` means an APPROVAL hold only where the file draws its
 * held population from the held-by-approval predicate (Home's
 * `needsYouAction`). Elsewhere (`/apps/[name]`'s task kinds) `held` is a
 * PIN, whose "Clear pin" / "Pick a different version" are real acts.
 */
const APPROVAL_HELD = /kind === 'held'/;
const USES_APPROVAL_POPULATION = /\bheldByApproval\b|isHeldByApproval\(/;

const indentOf = (line: string) => (line.match(/^\s*/)?.[0] ?? '').replace(/\t/g, '    ').length;

/** Every (file:line) where an approval branch reaches a dialog opener. */
export function approvalBranchesThatOpenTheDialog(files: { path: string; text: string }[]): string[] {
	const hits: string[] = [];
	for (const { path, text } of files) {
		const lines = text.split('\n');
		const markers = USES_APPROVAL_POPULATION.test(text) ? [...MARKERS, APPROVAL_HELD] : MARKERS;
		lines.forEach((line, i) => {
			if (!markers.some((m) => m.test(line))) return;
			const trimmed = line.trim();
			// A declaration of the population is not a branch about it.
			if (/^(const|let|export const)\s+\w*heldByApproval\b/.test(trimmed)) return;
			if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('<!--')) return;
			const base = indentOf(line);
			const block = [line];
			for (let j = i + 1; j < lines.length; j++) {
				const l = lines[j];
				if (l.trim() === '') continue;
				if (indentOf(l) <= base) break;
				block.push(l);
			}
			const opener = block.find((l) => OPENERS.test(l) && !/^\s*(\/\/|\*|<!--)/.test(l));
			if (opener) hits.push(`${path}:${i + 1} → ${opener.trim()}`);
		});
	}
	return hits;
}

/**
 * ⛔ qa11c B1 — THE DATA-FLOW HALF. The lexical scan above follows a branch
 * that is ABOUT an approval; it cannot follow a VALUE. /apps/[name] shipped
 * the shape it missed: an ADVERSE (failed/stuck) task computed
 * `const approval = f.story.person.length > 0`, took the build the approval
 * gate is refusing (`waitingBuildsFor(f)[0]`) under `approval ? …`, stored it
 * as the task's `promoteTag`, and a different render branch (`{:else}` for
 * adverse rows) handed `t.promoteTag` to `openPromote` — the deploy dialog,
 * past the approval. No line of that path is inside an approval branch.
 *
 * The rule here: the build a refusing gate is waiting on — anything taken
 * from `waitingBuildsFor(…)`, or chosen under an `approval… ?` condition —
 * is never assigned to a field or variable that a deploy opener consumes
 * (`promoteTag` / `promoteVersion`, or an opener's own argument list).
 */
const REFUSED_BUILD = /waitingBuildsFor\(|\bapproval\w*\s*\?/;
export function refusedBuildsHandedToADeploy(files: { path: string; text: string }[]): string[] {
	const hits: string[] = [];
	for (const { path, text } of files) {
		const lines = text.split('\n');
		const tainted = new Set<string>();
		for (const line of lines) {
			const m = line.match(/^\s*(?:const|let)\s+(\w+)\s*=\s*(.*)$/);
			if (m && REFUSED_BUILD.test(m[2])) tainted.add(m[1]);
		}
		const taintRe = tainted.size ? new RegExp(`\\b(${[...tainted].join('|')})\\b`) : null;
		lines.forEach((line, i) => {
			const t = line.trim();
			if (t.startsWith('//') || t.startsWith('*') || t.startsWith('<!--')) return;
			const intoDeployField = /\bpromote(Tag|Version)\s*:/.test(line);
			const intoOpener = OPENERS.test(line);
			if (!intoDeployField && !intoOpener) return;
			if (REFUSED_BUILD.test(line) || (taintRe && taintRe.test(line))) hits.push(`${path}:${i + 1} → ${t}`);
		});
	}
	return hits;
}

describe('qa11b — no approval control opens the deploy dialog', () => {
	test('no approval-hold branch in src reaches ChangeVersionModal / ChangeVersionFlow', () => {
		const files = sourceFiles(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, 'utf8') }));
		expect(files.length).toBeGreaterThan(50);
		expect(approvalBranchesThatOpenTheDialog(files)).toEqual([]);
	});

	test('the guard itself catches the shape that shipped (Home and /apps/[name] before qa11b)', () => {
		const home = [
			'\tconst heldByApproval = $derived(cards.filter(isHeldByApproval));',
			"\t\tif (kind === 'held') {",
			'\t\t\treturn {',
			"\t\t\t\tlabel: stepLabel('approve'),",
			'\t\t\t\trun: () => openVersion(c, next)',
			'\t\t\t};',
			'\t\t}',
			"\t\tif (kind === 'failed') {",
			'\t\t\treturn { run: () => openVersion(c, prev) };',
			'\t\t}'
		].join('\n');
		const app = [
			"\t\t{:else if t.kind === 'approve'}",
			'\t\t\t<button onclick={() => openPromote(f.cell, t.promoteTag, t.promoteVersion)}>',
			'\t\t{:else}'
		].join('\n');
		const hits = approvalBranchesThatOpenTheDialog([
			{ path: 'home.svelte', text: home },
			{ path: 'app.svelte', text: app }
		]);
		expect(hits).toHaveLength(2);
		// the failed branch (a real deploy) is NOT flagged
		expect(hits.some((h) => h.includes('openVersion(c, prev)'))).toBe(false);
	});

	test('qa11c B1 — no build a refusing gate is waiting on is handed to a deploy', () => {
		const files = sourceFiles(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, 'utf8') }));
		expect(refusedBuildsHandedToADeploy(files)).toEqual([]);
	});

	test('the data-flow guard catches the shape that shipped (an adverse task carrying the approval build)', () => {
		const app = [
			'\t\t\tconst approval = f.story.person.length > 0;',
			'\t\t\tconst head = approval ? (waitingBuildsFor(f)[0] ?? null) : null;',
			'\t\t\tout.push({',
			"\t\t\t\tkind: 'adverse',",
			'\t\t\t\tpromoteVersion: head?.version ?? null,',
			'\t\t\t\tpromoteTag: head?.tag ?? null',
			'\t\t\t});'
		].join('\n');
		const hits = refusedBuildsHandedToADeploy([{ path: 'app.svelte', text: app }]);
		expect(hits).toHaveLength(2);
		// an ordinary promotion candidate is not flagged
		const ok = '\t\t\t\tpromoteTag: offer?.tag ?? null,';
		expect(refusedBuildsHandedToADeploy([{ path: 'ok.svelte', text: ok }])).toEqual([]);
	});

	test('the approve step reads the review form only — "Approve" is gone until an endpoint exists', () => {
		expect(stepLabel('approve')).toBe('Review approval');
		expect(stepLabel('approve', { env: 'prod' })).toBe('Review approval in prod');
		expect(stepLabel('approve', { env: 'prod', navigate: true })).toBe('Review approval in prod');
		expect(stepLabel('approve', { env: 'prod' })).not.toMatch(/^Approve/);
	});
});
