<svelte:options runes={true} />

<script lang="ts">
	import { ServerOutline } from 'flowbite-svelte-icons';

	/**
	 * ⭐ THE CLUSTER, SAID SO THAT IT CANNOT BE READ AS THE ENVIRONMENT.
	 *
	 * A live critique of `/rollouts`: group headers read `dev /
	 * hello-world-staging` while every row inside them said **staging**, and
	 * the filter row's five chips had the accessible names `prod`, `dev`,
	 * `dev`, `staging`, `prod` — two families, adjacent, unlabelled, with the
	 * same word meaning two different things twice. On the live hub/spoke
	 * topology that collision is REAL and not a bug to be renamed away: the
	 * spoke cluster is called `dev` and it hosts the `staging` namespaces.
	 *
	 * So the two families are told apart by three cues at once, and the first
	 * of them is a WORD, because a glyph alone still has to be learned:
	 *
	 *   1. it says `cluster`;
	 *   2. a server glyph — the product's mark for the machine, never for a
	 *      stage of a pipeline;
	 *   3. lowercase and neutral, where an environment is an UPPERCASE
	 *      coloured `Chip`. Case alone separates them across a wrapped row.
	 *
	 * IT CARRIES NO COLOUR OF ITS OWN. Both call sites need a different ink
	 * (muted gray in a section header, knockout inside a selected filter
	 * pill), so every part of this inherits `currentColor` and the parent
	 * decides. The ladder inside the token is SIZE and CASE, never opacity —
	 * dimming instead of explaining is the pattern this repo has rejected
	 * twice.
	 */
	let {
		name,
		class: className = ''
	}: {
		name: string;
		class?: string;
	} = $props();

	/**
	 * ⛔ A LABEL THAT NAMES NOTHING IS WORSE THAN NO LABEL. (2026-08-31)
	 *
	 * With an empty `name` this rendered the word `cluster` followed by
	 * nothing, and its own tooltip read `Cluster  — the Kubernetes cluster
	 * these rollouts run on`. It tells the reader the answer is on screen when
	 * it is not — the same shape as the `−N`-from-`null` defect, one object
	 * over. That state is reachable: the label was derived from the LEGACY
	 * `source-dashboard` annotation, and a rollout carrying only
	 * `source-cluster` produced an empty string.
	 *
	 * `/rollouts` now prefers the cluster NAME, so the empty case should not
	 * arise; this refuses to draw at all if it ever does again. A missing
	 * qualifier is a namespace with no qualifier, which is what the page looked
	 * like before the mark existed.
	 */
	const named = $derived((name ?? '').trim());
</script>

{#if named}
<span
	class="inline-flex min-w-0 items-center gap-1 {className}"
	title={`Cluster ${named} — the Kubernetes cluster these rollouts run on, not the environment they serve`}
>
	<ServerOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
	<span class="t-micro shrink-0 leading-none">cluster</span>
	<span class="t-code-sm truncate leading-none">{named}</span>
</span>
{/if}
