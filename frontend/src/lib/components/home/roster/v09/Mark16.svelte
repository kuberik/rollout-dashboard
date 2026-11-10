<script lang="ts" module>
	/** The states the roster lists speak. Mapped 1:1 onto the tabs' own status family below. */
	export type RowState = 'failed' | 'stuck' | 'approval' | 'deploying' | 'checking' | 'held' | 'waiting' | 'rest' | 'arrived' | 'rolledback';
</script>

<script lang="ts">
	/**
	 * craft r1 — THE STATUS COLUMN, drawn by the tabs' own components (AUDIT #4). v01-v08 drew a second
	 * family (depot `StateGlyph`: rings and pies, approval in amber); switching from a rollout tab to a
	 * list page changed every mark. This is a mapping, not a drawing: failed / stuck / held / deploying /
	 * checking / approval = `StatusMark`; at rest and arrived = StatusMark's 6px success dot (RestGlyph's
	 * size); waiting (a newer build not started, waits on others) = StatusMark `behind`, the hollow ring.
	 * craft r5 (D3): `rolledback` = StatusMark failed `resolved` (the tabs' muted "!": it failed and was undone, it is not failing now). Amber stays "stuck" only (LANG 3.3). Usable as a `Card` icon (it accepts and ignores `class`).
	 */
	import StatusMark from '$lib/components/StatusMark.svelte';
	let { state, label = undefined, class: _c = '' }: { state: RowState; label?: string; class?: string } = $props();
	const MAP = { failed: 'failed', stuck: 'stuck', approval: 'approval', deploying: 'deploying', checking: 'checking', held: 'held', waiting: 'behind', rest: 'newest', arrived: 'newest', rolledback: 'failed' } as const;
</script>

<StatusMark state={MAP[state]} {label} resolved={state === 'rolledback'} />
