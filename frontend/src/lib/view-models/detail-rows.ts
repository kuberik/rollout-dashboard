/**
 * One line of a report banner's Details (`Banner`): a name, an optional one-word severity or state, a fact. The banner
 * draws every row in the same columns, so a view-model only decides WHAT each cell says, never how wide it is.
 */
export interface DetailRow {
	key: string;
	/** the check, object or label; truncates with a native tooltip (`title`) when it is long */
	name: string;
	/** the name is an identifier (check, rollout, build): drawn in the code role */
	mono?: boolean;
	/** one word of severity or state ("Critical", "Warning"), plain text, never a chip */
	tag?: string;
	tone?: 'danger' | 'muted';
	/** the fact: a measurement, a reason, a hint */
	text?: string;
	/** the row's native tooltip (the long form of the row) */
	title?: string;
	href?: string;
}
