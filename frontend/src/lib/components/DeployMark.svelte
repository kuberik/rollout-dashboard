<svelte:options runes={true} />

<script lang="ts">
	/**
	 * The ONE mark for a person-pressed deploy, on /activity (FeedRow) and /envs (DayRow): the word "manual" (`deployMark`); no separate override mark (owner, 2026-11-09). Role: a state word beside the sentence, same `t-meta` subtle ink as the age. One form at every width
	 * (no icon: the person's own avatar is the glyph, a second one duplicated it). Borrows the verb-adjacent slot of FeedRow.
	 */
	import type { DeployMark } from '$lib/view-models/activity-note';
	let { mark }: { mark: Exclude<DeployMark, null> } = $props();
	const TITLE = { manual: 'Manual deploy: a person pressed deploy' };
</script>

<span class="t-meta shrink-0 text-fg-subtle" data-manual-deploy data-deploy-mark={mark} title={TITLE[mark]}>{mark}</span>
