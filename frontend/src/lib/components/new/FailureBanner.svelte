<svelte:options runes={true} />

<script lang="ts">
	/**
	 * The failure statement of the LIST pages (/rollouts, /changes, /envs/<name>): "<app> failed in <place>", the failed check, the meta line (the place is the title's),
	 * the change that failed, and Open rollout / Roll back. Role: the page's one blocking statement, the same as /apps and the app page print.
	 * No existing component was missing: this IS `StatementBanner` (shell, meta line, phone action row, the ⋯ menu), given the list pages'
	 * banner model once so the three pages stop hand-building a raw `AlertPanel` + `.btn` links (which had no meta line and no phone row).
	 * Wording is the model's own (`failedBannerTitle`, the check, the failure line); this file words nothing.
	 */
	import type { Act } from '$lib/components/ActRow.svelte';
	import StatementBanner from '$lib/components/StatementBanner.svelte';
	import { UndoOutline, PlaySolid } from 'flowbite-svelte-icons';
	import { failureActs } from '$lib/view-models/failure-actions';
	import type { Snippet } from 'svelte';
	import FailureDetails from '$lib/components/FailureDetails.svelte';
	import { agoOf, withAge, type BannerEvidence } from '$lib/view-models/health-failures';
	import { now } from '$lib/stores/time';
	import type { BannerMeta, ChangeLine } from './rollouts-page';

	let { b, extra }: {
		b: { /** the Overview banner's evidence (same lines, Details and class glyph); absent = the check + line the row carries */ evidence?: BannerEvidence | null; title: string; check: { name: string; message: string } | null; line: string | null; change: ChangeLine | null; openHref: string; rollbackHref: string | null; /** every check is OK again: Retry leads (view-models/failure-actions.ts) */ recovered?: boolean; /** where Retry goes: the rollout, which holds the retry and its confirmation (defaults to openHref) */ retryHref?: string; meta: BannerMeta };
		/** one more row under the sentence (/envs: the newer build that is waiting) */
		extra?: Snippet;
	} = $props();
	/* the age rides on the health line ("2 health checks failing, 1 pending · 12m ago"), as on the rollout Overview's banner; the meta line keeps only the build */
	const age = $derived(b.meta.sinceAt ? agoOf(b.meta.sinceAt, $now) : b.meta.since);
	const sentence = $derived(b.evidence ? (b.evidence.recovered ? b.evidence.message : withAge(b.evidence.message, age)) : b.check ? undefined : b.line ? withAge(b.line, age) : undefined);
	const acts = $derived(failureActs<Act>(!!b.recovered, {
		rollback: b.rollbackHref ? { label: 'Roll back', href: b.rollbackHref, icon: UndoOutline, key: 'rollback' } : null,
		/* a failure still failing keeps its order and its buttons: Retry is offered here only once its checks are OK again */
		retry: b.recovered ? { label: 'Retry', href: b.retryHref ?? b.openHref, icon: PlaySolid, iconClass: 'h-5 w-5', key: 'retry' } : null,
		rest: [{ label: 'Open rollout', href: b.openHref, after: true, key: 'open' }]
	}));
</script>

{#snippet details()}{#if b.evidence}<FailureDetails pool={b.evidence.pool} />{/if}{/snippet}
<StatementBanner severity="failed" title={b.title} recovered={!!b.recovered} check={b.evidence ? b.evidence.check : b.check ?? undefined} observations={b.evidence?.observations}
	message={sentence} change={b.change ? { ...b.change, build: b.meta.build ?? undefined } : undefined}
	build={b.change ? undefined : b.meta.build ?? undefined} body={extra} class=""
	footnoteLabel={b.evidence ? 'Details' : undefined}
	primary={acts.primary} secondary={acts.secondary} footnoteBody={b.evidence ? details : undefined} />
