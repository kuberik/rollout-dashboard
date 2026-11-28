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
	import { UndoOutline } from 'flowbite-svelte-icons';
	import { retryActionHref } from './rollout-view';
	import { failureActs } from '$lib/view-models/failure-actions';
	import { rollbackOwnedReason } from './data';
	import type { Snippet } from 'svelte';
	import FailureDetails from '$lib/components/FailureDetails.svelte';
	import { agoOf, withAge, type BannerEvidence } from '$lib/view-models/health-failures';
	import { now } from '$lib/stores/time';
	import type { BannerMeta, ChangeLine } from './rollouts-page';
	import { titleParts } from '$lib/view-models/banner';

	let { b, extra }: {
		b: { /** the Overview banner's evidence (same lines, Details and class glyph); absent = the check + line the row carries */ evidence?: BannerEvidence | null; title: string; check: { name: string; message: string } | null; line: string | null; change: ChangeLine | null; openHref: string; rollbackHref: string | null; /** every check is OK again: Retry leads (view-models/failure-actions.ts) */ recovered?: boolean; /** where Retry goes: the rollout, which holds the retry and its confirmation (defaults to openHref) */ retryHref?: string; meta: BannerMeta };
		/** one more fact about the failure (/envs: the newer build that is waiting); it opens under Details (title + one line) */
		extra?: Snippet;
	} = $props();
	/* the age rides on the health line ("2 health checks failing, 1 pending · 12m ago"), as on the rollout Overview's banner; the meta line keeps only the build */
	const age = $derived(b.meta.sinceAt ? agoOf(b.meta.sinceAt, $now) : b.meta.since);
	const sentence = $derived(b.evidence ? (b.evidence.recovered ? b.evidence.message : withAge(b.evidence.message, age)) : b.check ? undefined : b.line ? withAge(b.line, age) : undefined);
	/* "invoice-api failing in prod · eu-west": the region is drawn as a chip on the sentence's row, so the title is one line at 390 */
	const tp = $derived(titleParts(b.title));
	const region = $derived.by(() => { const at = tp.place?.indexOf(' · ') ?? -1; return tp.place && at > 0 ? { env: tp.place.slice(0, at), place: tp.place.slice(at + 3) } : null; });
	const bannerTitle = $derived(region ? tp.lead + region.env : b.title);
	/* another controller owns the wanted version: Roll back stays drawn, disabled, with the reason the header and the Overview give */
	const ownedReason = $derived(rollbackOwnedReason(b.rollbackHref));
	const acts = $derived(failureActs<Act>(!!b.recovered, {
		rollback: b.rollbackHref ? (ownedReason ? { label: 'Roll back', icon: UndoOutline, key: 'rollback', disabled: true, title: ownedReason } : { label: 'Roll back', href: b.rollbackHref, icon: UndoOutline, key: 'rollback' }) : null,
		/* a failure still failing keeps its order and its buttons: Retry is offered here only once its checks are OK again */
		retry: b.recovered ? { label: 'Retry', href: retryActionHref(b.retryHref ?? b.openHref), key: 'retry' } : null,
		rest: [{ label: 'Open rollout', href: b.openHref, after: true, key: 'open' }]
	}));
</script>

{#snippet regionChip()}{#if region}<span class="bn-chip t-code-sm" data-banner-region title="{region.env} · {region.place}">{region.place}</span>{/if}{/snippet}
{#snippet details()}{#if extra}<div class="mb-2">{@render extra()}</div>{/if}{#if b.evidence}<FailureDetails pool={b.evidence.pool} />{/if}{/snippet}
<StatementBanner severity="failed" title={bannerTitle} shape={region ? regionChip : undefined} recovered={!!b.recovered} check={b.evidence ? b.evidence.check : b.check ?? undefined} observations={b.evidence?.observations}
	message={sentence} change={b.change ? { ...b.change, build: b.meta.build ?? undefined } : undefined}
	class=""
	footnoteLabel={b.evidence || extra ? 'Details' : undefined}
	primary={acts.primary} secondary={acts.secondary} footnoteBody={b.evidence || extra ? details : undefined} />
