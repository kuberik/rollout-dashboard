/**
 * THE ONE PHONE-FOLD RULE FOR A SECTION HEADER'S ROLLUP (QA2 #7). On a phone the rollup has room for little, and the part that goes is
 * the one that says nothing: a ZERO count ("0 moving"). Every non-zero count stays ("1 waiting", "20 at rest"), and so does an inked
 * (adverse) part. Before this, every plain part but the last folded, which dropped "1 waiting" and left only "20 at rest" at 390.
 * A plain part that is not a count ("5h ago") keeps the old behaviour and folds.
 */
export type RollupPart = string | { text: string; ink?: 'danger' | 'held' };

export function foldsOnPhone(part: RollupPart): boolean {
	if (typeof part !== 'string') return false;
	const m = /^(\d+)\s/.exec(part.trim());
	return m ? Number(m[1]) === 0 : true;
}
