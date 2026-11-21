/**
 * The History tab's day sections. Consecutive entries of one day share a section; an entry that
 * comes back to a day already shown (history is ordered by id, so a clock step or an entry
 * stamped with its judged time can step backwards) opens a second section for it. Section keys
 * feed a keyed `{#each}`, so they must stay distinct: the repeat gets `#2`, `#3`.
 */
export type DayGroup<T> = { key: string; day: string; label: string; total: number; items: T[] };

export function groupByDay<T>(
	items: readonly T[],
	o: { dayKeyOf: (item: T) => string; labelOf: (day: string) => string; totalOf: (day: string) => number }
): DayGroup<T>[] {
	const groups: DayGroup<T>[] = [];
	const seen = new Map<string, number>();
	for (const item of items) {
		const day = o.dayKeyOf(item);
		const last = groups[groups.length - 1];
		if (last && last.day === day) {
			last.items.push(item);
			continue;
		}
		const n = (seen.get(day) ?? 0) + 1;
		seen.set(day, n);
		groups.push({ key: n === 1 ? day : `${day}#${n}`, day, label: o.labelOf(day), total: o.totalOf(day), items: [item] });
	}
	return groups;
}
