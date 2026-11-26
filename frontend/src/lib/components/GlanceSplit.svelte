<svelte:options runes={true} />

<script lang="ts">
	/**
	 * A GLANCE BANNER'S BODY, IN TWO COLUMNS WHEN THERE IS ROOM (owner 2026-11-26: a wide banner left its right side empty;
	 * "details could go there").
	 * Role: the body of a status banner that follows the glanceable-UI rule. LEFT: the drawn fact (a chip row) and at most one
	 * short line. RIGHT: the record — compact label/value rows, always visible. When the banner itself is narrow (a phone, a
	 * rail), the record folds under one `Details` toggle instead, so the banner stays a headline, one row and one line.
	 * Why new: `AlertPanel`'s `footnote` is a disclosure at every width; a record that fits beside the fact should not cost a
	 * click. Shared on purpose: the "Deploy refused" banner uses it first, and the rollback banners (`RollbackGlance`) are
	 * meant to put their chip row in `main` and their details in `facts`, so every glance banner splits at the same width.
	 * Built from: `FactList` (the product's one aligned `<dl>`, `tone="banner"` so it reads in the severity's ink) and the
	 * `Details` summary vocabulary (`lib/disclosure.ts`: one record with fields → `Details`). One DOM copy of the record at
	 * every width (the message census walks `textContent`): CSS container queries decide column vs toggle, not a second render.
	 */
	import type { Snippet } from 'svelte';
	import { ChevronRightOutline } from 'flowbite-svelte-icons';
	import FactList, { type Fact } from './FactList.svelte';

	let { main, facts = [] }: { main: Snippet; facts?: Fact[] } = $props();
	let open = $state(false);
</script>

<div class="glance-split-cq min-w-0">
	<div class="glance-split" data-glance-split>
		<div class="min-w-0" data-glance-main>{@render main()}</div>
		{#if facts.length}
			<button
				type="button"
				class="glance-toggle t-ui-sm hit-32 inline-flex items-center gap-1 self-start"
				aria-expanded={open}
				onclick={() => (open = !open)}
				data-glance-toggle
			>
				<ChevronRightOutline class="h-3 w-3 transition-transform {open ? 'rotate-90' : ''}" aria-hidden="true" />Details
			</button>
			<div class="glance-facts min-w-0" data-open={open} data-glance-facts>
				<FactList {facts} tone="banner" />
			</div>
		{/if}
	</div>
</div>

<style>
	.glance-split-cq {
		container-type: inline-size;
	}
	.glance-split {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.glance-facts {
		display: none;
	}
	.glance-facts[data-open='true'] {
		display: block;
	}
	/* Beside the fact once the banner body is wide enough for both: the record is always shown and the toggle goes. The
	   record column is capped so it stays a compact side record, never a second paragraph across half the page. */
	@container (min-width: 720px) {
		.glance-split {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(260px, 420px);
			column-gap: 32px;
			align-items: start;
		}
		.glance-toggle {
			display: none;
		}
		.glance-facts {
			display: block;
			border-left: 1px solid color-mix(in srgb, currentColor 18%, transparent);
			padding-left: 16px;
		}
	}
</style>
