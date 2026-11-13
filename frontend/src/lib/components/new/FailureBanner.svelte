<svelte:options runes={true} />

<script lang="ts">
	/**
	 * The failure statement of the LIST pages (/rollouts, /changes, /envs/<name>): "<app> failed in <place>", the failed check, the meta line,
	 * the change that failed, and Open rollout / Roll back. Role: the page's one blocking statement, the same as /apps and the app page print.
	 * No existing component was missing: this IS `StatementBanner` (shell, meta line, phone action row, the ⋯ menu), given the list pages'
	 * banner model once so the three pages stop hand-building a raw `AlertPanel` + `.btn` links (which had no meta line and no phone row).
	 * Wording is the model's own (`failedBannerTitle`, the check, the failure line); this file words nothing.
	 */
	import StatementBanner from '$lib/components/StatementBanner.svelte';
	import { UndoOutline } from 'flowbite-svelte-icons';
	import { getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import type { Snippet } from 'svelte';
	import type { BannerMeta, ChangeLine } from './rollouts-page';

	let { b, extra }: {
		b: { title: string; check: { name: string; message: string } | null; line: string | null; change: ChangeLine | null; openHref: string; rollbackHref: string | null; meta: BannerMeta };
		/** one more row under the sentence (/envs: the newer build that is waiting) */
		extra?: Snippet;
	} = $props();
	const place = $derived(b.meta.place ? { label: b.meta.place, theme: getRolloutEnvironmentTheme(null, b.meta.tier === 'prod' ? 'prod' : b.meta.place) } : undefined);
</script>

<StatementBanner severity="failed" title={b.title} check={b.check ?? undefined} message={b.check ? undefined : (b.line ?? undefined)} change={b.change ?? undefined}
	{place} since={b.meta.since ?? undefined} build={b.meta.build ?? undefined} body={extra} class=""
	primary={b.rollbackHref ? { label: 'Roll back', href: b.rollbackHref, icon: UndoOutline, key: 'rollback' } : undefined}
	secondary={[{ label: 'Open rollout', href: b.openHref, after: true, key: 'open' }]} />
