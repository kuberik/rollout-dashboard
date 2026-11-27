<svelte:options runes={true} />

<script lang="ts">
	/**
	 * A REFUSED WRITE, DRAWN (the Ready=False "Deploy refused" banner, `ready-refusal.ts`).
	 * Role: the one row under the "Deploy refused" headline for a field conflict:
	 *   `[HelmRelease|shop] spec.upgrade.remediation.retries  [kustomize-controller] → [kuberik] ✕`
	 * the object, the field it would write, who sets that field now, and kuberik not taking it over. Owner 2026-11-26: the
	 * sentence form ("HelmReleaseFieldConflict on <path>, also set by <manager>") was "a wall of text"; the glanceable-UI rule
	 * says draw a fact that has a shape and do not also write it. The sentence stays as the row's title.
	 * Why new: `BreakRows` draws a version constraint between two rollouts; this is one object's field and two writers.
	 * Drawing borrowed from `BreakRows` (joined `[label|value]` Chip, identifier-only Chip, an arrow between two operands, a
	 * danger ✕) and its 14px mark column + 8px gap, so the two banners read as one family. The controller's message carries
	 * no values, so none are drawn (never half a relation).
	 */
	import { ArrowRightOutline, CloseOutline, FileCodeOutline } from 'flowbite-svelte-icons';
	import Chip from './Chip.svelte';
	import { pathParts } from '$lib/view-models/ready-refusal';

	let { conflict, title = '' }: { conflict: { kind: string; name: string; path: string; by: string }; title?: string } = $props();
	const parts = $derived(pathParts(conflict.path));
</script>

<!-- `items-start` + the mark nudged to the first line's centre: on a phone the row wraps to two or three lines, and the mark
     belongs to the object chip it precedes, not to the middle of the stack. -->
<div class="grid grid-cols-[14px_minmax(0,1fr)] items-start gap-x-2" data-testid="conflict-row" {title}>
	<FileCodeOutline class="mt-[3px] h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
	<span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
		<Chip role="count" label={conflict.kind} value={conflict.name} valueIsBuild={false} />
		<!-- The path wraps only at its dots: a `<wbr>` after each, never a character in the text, so a copied path is clean. -->
		<span class="t-code-sm min-w-0 break-normal text-fg" data-ready-path
			>{#each parts as part, pi (pi)}{part}{#if pi < parts.length - 1}<wbr />{/if}{/each}</span
		>
		<!-- whole chips only: the writer → kuberik ✕ group wraps as a unit and never squeezes a chip to an ellipsis -->
		<span class="flex min-w-0 flex-wrap items-center gap-1">
			<span class="shrink-0" data-ready-by><Chip role="count" label="" value={conflict.by} valueIsBuild={false} /></span>
			<span class="flex shrink-0 items-center gap-1">
				<ArrowRightOutline class="h-3 w-3 shrink-0 text-fg-muted" aria-hidden="true" />
				<Chip role="count" label="" value="kuberik" valueIsBuild={false} />
				<CloseOutline class="h-3.5 w-3.5 shrink-0 text-danger" aria-label="kuberik won't overwrite it" />
			</span>
		</span>
	</span>
</div>
