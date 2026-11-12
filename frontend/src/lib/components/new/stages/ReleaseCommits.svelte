<script lang="ts">
	/**
	 * IN THIS RELEASE (app-pipeline r2) — "what is in the build that is rolling out?": the builds between what production runs and the
	 * release, newest first. ROLE: the Pipeline tab's second region, below the graph (the Gates tab's canvas has no rail either).
	 * REFERENCE: the Change page's Change card (`ChangeCard`: kind mark · title · sha right · author line, rollup, 47px header). It is REUSED,
	 * not forked: the card gained a title, an optional diffstat and link per row, and a row cap with a "N more" link. Rows link to the
	 * change page that carries the build. Rows come from the fleet snapshot (the same stops the Builds card draws); the diffstat fills in
	 * when GitHub answers and sits on the author line, so nothing moves.
	 * EMPTY: every place already runs the release: said inside the card, in the card's own proportions (a 47px header, one body line).
	 * No loading or error state of its own: the page is gated by FleetGate, and a diffstat that is not (yet) known is simply absent.
	 * It shows at every width, below the graph (rows are 44px+ links: the title link is stretched over the row).
	 */
	import Card from '$lib/components/Card.svelte';
	import { CodeBranchOutline } from 'flowbite-svelte-icons';
	import ChangeCard from '../change/ChangeCard.svelte';
	import type { ReleaseCommits } from './stages-model';

	let { release, class: className = '' }: { release: ReleaseCommits; class?: string } = $props();
	const CAP = 6;
</script>

{#if release.status === 'ready'}
	<ChangeCard
		title="In this release"
		commits={release.commits}
		max={CAP}
		more={release.href ? { text: `${release.commits.length - CAP} more`, href: release.href } : null}
		class={className}
	/>
{:else if release.status === 'empty' && release.release}
	<Card icon={CodeBranchOutline} title="In this release" padded={false} class={className}>
		<p class="t-body flex min-h-12 items-center gap-2 px-4 py-3 text-fg-muted" data-release-empty>Every place runs <span class="t-code-sm text-fg">{release.release}</span></p>
	</Card>
{/if}
