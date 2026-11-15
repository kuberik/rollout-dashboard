<svelte:options runes={true} />

<script lang="ts">
	/**
	 * The failure statement of the LIST pages (/rollouts, /changes, /envs/<name>): "<app> failed in <place>", the failed check, the meta line (Since · build; the place is the title's),
	 * the change that failed, and Open rollout / Roll back. Role: the page's one blocking statement, the same as /apps and the app page print.
	 * No existing component was missing: this IS `StatementBanner` (shell, meta line, phone action row, the ⋯ menu), given the list pages'
	 * banner model once so the three pages stop hand-building a raw `AlertPanel` + `.btn` links (which had no meta line and no phone row).
	 * Wording is the model's own (`failedBannerTitle`, the check, the failure line); this file words nothing.
	 */
	import StatementBanner from '$lib/components/StatementBanner.svelte';
	import { UndoOutline } from 'flowbite-svelte-icons';
	import type { Snippet } from 'svelte';
	import FailureDetails from '$lib/components/FailureDetails.svelte';
	import type { BannerEvidence } from '$lib/view-models/health-failures';
	import type { BannerMeta, ChangeLine } from './rollouts-page';

	let { b, extra }: {
		b: { /** the Overview banner's evidence (same lines, Details and class glyph); absent = the check + line the row carries */ evidence?: BannerEvidence | null; title: string; check: { name: string; message: string } | null; line: string | null; change: ChangeLine | null; openHref: string; rollbackHref: string | null; meta: BannerMeta };
		/** one more row under the sentence (/envs: the newer build that is waiting) */
		extra?: Snippet;
	} = $props();
</script>

{#snippet details()}{#if b.evidence}<FailureDetails pool={b.evidence.pool} />{/if}{/snippet}
<StatementBanner severity="failed" title={b.title} check={b.evidence ? b.evidence.check : b.check ?? undefined} observations={b.evidence?.observations}
	message={b.evidence ? b.evidence.message : b.check ? undefined : (b.line ?? undefined)} change={b.change ?? undefined}
	since={b.evidence?.recovered ? undefined : b.meta.since ?? undefined} sinceLabel="for" build={b.meta.build ?? undefined} body={extra} class=""
	footnoteLabel={b.evidence ? 'Details' : undefined}
	primary={b.rollbackHref ? { label: 'Roll back', href: b.rollbackHref, icon: UndoOutline, key: 'rollback' } : undefined}
	secondary={[{ label: 'Open rollout', href: b.openHref, after: true, key: 'open' }]} footnoteBody={b.evidence ? details : undefined} />
