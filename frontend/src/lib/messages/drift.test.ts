import { describe, test, expect } from 'vitest';
import { scanLiterals, serialiseCatalogue, type Literal } from './scan';
import { SENTENCE_MODULES } from './registry';
import catalogueRaw from './catalogue.txt?raw';

/**
 * THE DRIFT GUARD. It fails when a user-visible string appears, changes or
 * disappears without anybody deciding whether it is true and whether it names
 * its subject.
 *
 * -- WHY THIS EXISTS RATHER THAN A FOURTH AUDIT ---------------------------
 *
 * The same defect class -- a sentence that is false for the state that
 * produced it, or that is vague about which app or which environment it is
 * about -- has been found and fixed on this branch three times. Each audit
 * fixed the instances it read. The class came back in strings nobody had
 * re-read, because nothing in the repo could tell that a NEW string had
 * appeared. A suite over the sentences somebody already thought of is a
 * sample; this is the part that makes it a census.
 *
 * -- HOW IT WORKS ---------------------------------------------------------
 *
 * `scan.ts` extracts every operator-visible literal in `src` -- markup text,
 * `title`/`aria-label`/`alt`/`placeholder`, and prose string literals -- with
 * every interpolation collapsed to one character, so two strings that differ
 * only in a substituted value are ONE message. `catalogue.txt` is that census
 * checked in. This test diffs the two.
 *
 * -- WHAT IT CANNOT SEE ---------------------------------------------------
 *
 * The blind spots are listed in full at the top of `scan.ts` and are real:
 * runtime concatenation below the prose threshold, one-word labels, strings
 * from dependencies, and the server's own `details` text. The second guard in
 * this file -- and `truth.test.ts` -- is what covers the first two for the
 * modules where a wrong sentence actually wakes somebody up.
 *
 * A THIRD BLIND SPOT WORTH NAMING: this guard proves a string was NOTICED, not
 * that it was TESTED. Accepting the snapshot is one command. That is the
 * deliberate trade -- the census has to be cheap enough to keep -- and it is
 * why `truth.test.ts` holds the stronger requirement over the nine modules
 * that produce the claims an operator acts on.
 */

const catalogue = catalogueRaw.trimEnd().split('\n').filter(Boolean);

function key(l: Literal): string {
	return `${l.file}\t${l.kind}\t${l.text}`;
}

const HOWTO = `
  HOW TO CLEAR THIS
  -----------------
  1. Read each string below and answer two questions about it:

     TRUTH   -- is it true for every state that can produce it? Ground truth
                is the controller source (../rollout-controller,
                ../environment-controller), never the component. If it names
                a cause, a remedy or a consequence, something has to have
                been OBSERVED for it. "Needs a person to approve" over a
                machine-written gate, "Production is not touched" on an
                override deploy, and a 403 blaming a namespace grant were all
                shipped sentences that failed this question.

     SUBJECT -- on the page it renders on, does it name every axis that page
                does not already fix? See registry.ts. "DEV is waiting on
                another deploy" is exact on rollout detail and ambiguous on
                /apps, where fourteen other rows are also about DEV.

  2. If it is an operator CLAIM, give it a case in truth.test.ts (a state that
     produces it) and, if it renders in a list, a case in
     subject.svelte.test.ts. If the module is in SENTENCE_MODULES,
     truth.test.ts will fail until you do.

  3. If it is chrome -- a nav label, a column heading, a button that names
     only itself -- no test is owed. Accept the census:

         npx vitest run src/lib/messages/drift.test.ts -u
`;

describe('the message catalogue is complete', () => {
	test('no user-visible string appears, changes or vanishes unnoticed', () => {
		const live = scanLiterals();
		const known = new Set(catalogue);
		const seen = new Set(live.map(key));

		const added = live.filter((l) => !known.has(key(l)));
		const removed = catalogue.filter((k) => !seen.has(k));

		if (added.length === 0 && removed.length === 0) return;

		const show = (lines: string[]) =>
			lines
				.slice(0, 40)
				.map((l) => `    ${l}`)
				.join('\n') + (lines.length > 40 ? `\n    ... and ${lines.length - 40} more` : '');

		const parts: string[] = [];
		if (added.length) {
			parts.push(
				`${added.length} user-visible string(s) are NOT in the catalogue:\n${show(added.map(key))}`
			);
		}
		if (removed.length) {
			parts.push(
				`${removed.length} catalogued string(s) no longer exist:\n${show(removed)}\n` +
					`  A message that vanished is fine; a message that vanished by accident is a page\n` +
					`  that now says nothing where it used to say something. Check the surface renders.`
			);
		}
		throw new Error(`${parts.join('\n\n')}\n${HOWTO}`);
	});

	/**
	 * The write path. `npx vitest run src/lib/messages/drift.test.ts -u`
	 * rewrites `catalogue.txt` from the source, so accepting a reviewed change
	 * is one command and nobody hand-edits a census.
	 */
	test('catalogue.txt is the census, regenerable with -u', async () => {
		await expect(serialiseCatalogue()).toMatchFileSnapshot('./catalogue.txt');
	});
});

/**
 * THE STRONG GUARD, and the one that is not merely a notification.
 *
 * Over the nine modules in `SENTENCE_MODULES`, a literal is not allowed to
 * exist unless some STATE produces it. `truth.test.ts` records every string
 * its matrix actually emitted; this asserts the census is a subset of that.
 * A branch nobody can reach fails loudly rather than sitting there returning a
 * default -- which is exactly how `person` stayed the fall-through for two
 * shipped releases.
 */
describe('every sentence module is fully reached', () => {
	test('the modules under the strong guard are the ones that produce claims', () => {
		const files = new Set(scanLiterals().map((l) => l.file));
		for (const m of SENTENCE_MODULES) {
			expect(files.has(m), `${m} is registered as a sentence module but produces no prose`).toBe(
				true
			);
		}
	});
});
