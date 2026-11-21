/**
 * Keys for keyed `{#each}` blocks and correlation maps that cannot collide.
 *
 * A keyed each throws `each_key_duplicate` and takes the page down when two items share a key.
 * History timestamps are second-precision (an automatic rollback lands in the same second its
 * failed deploy is judged; two promotions can share a second), and one app name can exist in two
 * namespaces or clusters, so a key built from a name or a time alone is not identity.
 *
 * Prefer a real identity (`status.history[].id` plus the rollout's cluster/namespace/name, see
 * `historyEntryKey`). `uniqueKeyed` is the backstop for a list whose items already carry a
 * `key`: the first holder keeps its key, a repeat gets `#2`, `#3`, ... in list order.
 */

/** `items` with every repeated `key` suffixed so all keys are distinct; objects without a repeat are returned as-is. */
export function uniqueKeyed<T extends { key: string }>(items: readonly T[]): T[] {
	const seen = new Map<string, number>();
	let changed = false;
	const out = items.map((it) => {
		const n = (seen.get(it.key) ?? 0) + 1;
		seen.set(it.key, n);
		if (n === 1) return it;
		changed = true;
		return { ...it, key: `${it.key}#${n}` };
	});
	return changed ? out : (items as T[]);
}

/**
 * A history entry's identity across the whole fleet: the rollout it belongs to plus the entry's
 * `id` (int64, unique per rollout). Entries from before the controller wrote ids fall back to the
 * list position, which is unique within one `status.history` array.
 */
export function historyEntryKey(
	rollout: { cluster?: string | null; namespace?: string | null; name?: string | null },
	entry: { id?: number | null },
	index: number
): string {
	const where = `${rollout.cluster ?? ''}/${rollout.namespace ?? ''}/${rollout.name ?? ''}`;
	return entry.id != null ? `${where}#${entry.id}` : `${where}@${index}`;
}
