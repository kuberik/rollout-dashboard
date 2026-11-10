/**
 * ⭐ ROW ORDER IS DECIDED ON ARRIVAL, NOT ON EVERY UPDATE. (2026-10-07.)
 *
 * The dependency views sort held rows first. That is the right order to OPEN
 * on — the answer at the top — but recomputed on every live update it made a
 * row jump in one frame the moment its hold cleared over the stream:
 * `payments-svc` from the top of "Has to move first" to the bottom on the
 * demo's `payments` beat, `prod-eu-central` from first to third of "Moves
 * after this" on `regions`. A reader tracking a row loses it exactly when the
 * thing they were waiting for happens.
 *
 * So the sort decides the order once — on first load, and again whenever
 * `resetKey` changes (a navigation to another rollout, a different filter) —
 * and after that a live update keeps every existing row where it is, appends
 * rows that appear (in the sort's own order), and drops rows that vanish.
 */
export function stableOrder<T>(
	previous: readonly string[] | null,
	next: readonly T[],
	keyOf: (t: T) => string
): T[] {
	if (!previous) return [...next];
	const byKey = new Map(next.map((t) => [keyOf(t), t] as const));
	const kept = previous.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
	const seen = new Set(previous);
	return [...kept, ...next.filter((t) => !seen.has(keyOf(t)))];
}

/**
 * The stateful half: remembers the last order it handed out, and forgets it
 * when `resetKey` changes. Deliberately NOT reactive state — it is read and
 * written inside a `$derived`, and only the order it returns is rendered.
 */
export class StableOrder {
	private keys: string[] | null = null;
	private resetKey: string | undefined = undefined;

	apply<T>(resetKey: string, next: readonly T[], keyOf: (t: T) => string): T[] {
		if (resetKey !== this.resetKey) {
			this.resetKey = resetKey;
			this.keys = null;
		}
		const ordered = stableOrder(this.keys, next, keyOf);
		this.keys = ordered.map(keyOf);
		return ordered;
	}
}

/**
 * ⭐ A ROW THAT RESOLVES STAYS, MARKED RESOLVED. (2026-10-08.)
 *
 * The same principle as `StableOrder`, one step further: when a live update
 * REMOVES a row because the thing it reported is over (a held build the
 * contract now admits), the row is kept in place — with the last data it had
 * — and flagged `resolved`, so the card does not shrink and the page under it
 * does not jump up through the story. A row that comes back is live again.
 * Everything resets (and resolved rows drop) when `resetKey` changes or the
 * page is reloaded. Order is `StableOrder`'s: arrival order, new rows
 * appended.
 */
export type Retained<T> = { row: T; resolved: boolean };

export class RetainedRows<T> {
	private order: string[] = [];
	private last = new Map<string, T>();
	private resetKey: string | undefined = undefined;

	apply(resetKey: string, current: readonly T[], keyOf: (t: T) => string): Retained<T>[] {
		if (resetKey !== this.resetKey) {
			this.resetKey = resetKey;
			this.order = [];
			this.last = new Map();
		}
		const live = new Map(current.map((t) => [keyOf(t), t] as const));
		for (const [k, t] of live) this.last.set(k, t);
		const seen = new Set(this.order);
		for (const t of current) {
			const k = keyOf(t);
			if (!seen.has(k)) {
				this.order.push(k);
				seen.add(k);
			}
		}
		return this.order.map((k) => ({ row: live.get(k) ?? this.last.get(k)!, resolved: !live.has(k) }));
	}
}
