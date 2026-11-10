import { structuredPatch } from 'diff';

/**
 * THE DIFF PAGE'S ROWS — two manifest texts in, one flat list of rows out.
 *
 * ROLE: the model behind `ManifestDiff.svelte`, the diff body on
 * `/rollouts/…/diff/<build>`. Each row is one line of a unified diff (or one
 * hunk header), already carrying the line numbers, the indentation width and
 * the changed span inside a paired line — everything the view needs to lay a
 * line out without parsing anything itself.
 *
 * WHY NOT diff2html (squad-rollout, AD round 5, 2026-10-10): the page used to
 * hand a patch string to diff2html and then fight its table CSS — two number
 * columns sized for an absolutely positioned overlay, a code cell that
 * collapsed to 0px when asked to wrap, a hunk header clipped inside a cell,
 * GitHub's own canvas colour in dark mode. Six rounds of overrides never got
 * a readable phone diff. The rows here are plain data; the view is ours.
 *
 * The line matching itself is the `diff` package's `structuredPatch` (Myers),
 * the same algorithm the page already depended on; this module only shapes
 * its hunks. Pure: no DOM, no Svelte.
 *
 * REFERENCE: GitHub's unified view (old/new numbers, `@@` row, a stronger
 * tint on the changed word), Vercel's deployment diff (one number column on
 * a phone).
 */

export type DiffLineKind = 'context' | 'add' | 'del';

export type DiffLineRow = {
	type: 'line';
	kind: DiffLineKind;
	/** Line number in the old text; `null` on an added line. */
	oldNo: number | null;
	/** Line number in the new text; `null` on a deleted line. */
	newNo: number | null;
	/**
	 * The ONE number a narrow view prints: the old number on a deleted line
	 * (it has no new one), the new number otherwise.
	 */
	no: number;
	/** The line's text, without the diff marker, indentation kept. */
	text: string;
	/** Leading spaces (a tab counts as two), for the wrapped line's hanging indent. */
	indent: number;
	/**
	 * The changed span inside a line that was edited rather than replaced
	 * (`replicas: 4` → `replicas: 6`): `[start, end)` into `text`, widened to
	 * whole tokens. `null` when the whole line is the change.
	 */
	mark: [number, number] | null;
};

export type DiffHunkRow = {
	type: 'hunk';
	/** `@@ -3,14 +3,14 @@`, as git prints it. */
	header: string;
	oldStart: number;
	newStart: number;
	/** Unchanged lines skipped between the previous hunk (or the top) and this one. */
	hiddenBefore: number;
};

export type DiffRow = DiffLineRow | DiffHunkRow;

export type LineDiff = {
	rows: DiffRow[];
	add: number;
	del: number;
	/** Unchanged lines after the last hunk. */
	hiddenAfter: number;
};

function indentOf(text: string): number {
	let n = 0;
	for (const ch of text) {
		if (ch === ' ') n += 1;
		else if (ch === '\t') n += 2;
		else break;
	}
	return n;
}

const WORD = /[A-Za-z0-9_.\-]/;

/**
 * The span two lines differ in, `[start, endA)` in `a` and `[start, endB)` in
 * `b`, from their common prefix and suffix, widened outward to token edges so
 * a sha that happens to share a leading character still marks as one word.
 * `null` when either side would be marked whole (nothing to single out).
 */
export function changedSpan(
	a: string,
	b: string
): { a: [number, number]; b: [number, number] } | null {
	const max = Math.min(a.length, b.length);
	let p = 0;
	while (p < max && a[p] === b[p]) p++;
	let s = 0;
	while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
	let startA = p;
	let startB = p;
	let endA = a.length - s;
	let endB = b.length - s;
	// Widen to token edges (both sides share the prefix, so one walk serves both).
	while (startA > 0 && WORD.test(a[startA - 1])) {
		startA--;
		startB--;
	}
	while (endA < a.length && WORD.test(a[endA])) endA++;
	while (endB < b.length && WORD.test(b[endB])) endB++;
	const lead = indentOf(a);
	const wholeA = startA <= lead && endA >= a.length;
	const wholeB = startB <= indentOf(b) && endB >= b.length;
	if (wholeA || wholeB) return null;
	if (endA <= startA && endB <= startB) return null;
	return { a: [startA, endA], b: [startB, endB] };
}

/**
 * Rows for a unified diff of `oldText` → `newText` with `context` unchanged
 * lines around each change. Identical texts give no rows.
 */
export function lineDiff(oldText: string, newText: string, context = 3): LineDiff {
	const patch = structuredPatch('a', 'b', oldText, newText, '', '', { context });
	const rows: DiffRow[] = [];
	let add = 0;
	let del = 0;
	let prevOldEnd = 1; // first old line not yet shown
	const oldTotal = oldText === '' ? 0 : oldText.replace(/\n$/, '').split('\n').length;

	for (const h of patch.hunks) {
		// structuredPatch reports oldStart 0 for an empty old side.
		const oldStart = h.oldLines === 0 ? h.oldStart + 1 : h.oldStart;
		const newStart = h.newLines === 0 ? h.newStart + 1 : h.newStart;
		rows.push({
			type: 'hunk',
			header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
			oldStart,
			newStart,
			hiddenBefore: Math.max(0, oldStart - prevOldEnd)
		});

		let o = oldStart;
		let n = newStart;
		const lines = h.lines.filter((l) => !l.startsWith('\\'));
		let i = 0;
		while (i < lines.length) {
			const marker = lines[i][0];
			if (marker === ' ') {
				const text = lines[i].slice(1);
				rows.push({ type: 'line', kind: 'context', oldNo: o, newNo: n, no: n, text, indent: indentOf(text), mark: null });
				o++;
				n++;
				i++;
				continue;
			}
			// A change block: a run of deletions, then a run of additions.
			const dels: string[] = [];
			const adds: string[] = [];
			while (i < lines.length && lines[i][0] === '-') dels.push(lines[i++].slice(1));
			while (i < lines.length && lines[i][0] === '+') adds.push(lines[i++].slice(1));
			// Pair line k of each run only when the runs are the same length:
			// that is an edit in place; anything else is a replacement.
			const paired = dels.length === adds.length;
			const spans = paired ? dels.map((d, k) => changedSpan(d, adds[k])) : [];
			dels.forEach((text, k) => {
				rows.push({ type: 'line', kind: 'del', oldNo: o, newNo: null, no: o, text, indent: indentOf(text), mark: spans[k]?.a ?? null });
				o++;
				del++;
			});
			adds.forEach((text, k) => {
				rows.push({ type: 'line', kind: 'add', oldNo: null, newNo: n, no: n, text, indent: indentOf(text), mark: spans[k]?.b ?? null });
				n++;
				add++;
			});
		}
		prevOldEnd = o;
	}

	return { rows, add, del, hiddenAfter: patch.hunks.length ? Math.max(0, oldTotal - prevOldEnd + 1) : 0 };
}
