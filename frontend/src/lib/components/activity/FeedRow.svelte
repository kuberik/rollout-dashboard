<svelte:options runes={true} />

<script lang="ts">
	/**
	 * A FEED ROW (detail pass, 2026-11-08): one release's deploy on /activity.
	 * ROLE: "what deployed, where, when" for the fleet feed. Same role as DayRow on /envs/<name> ("Today in prod"), which is why it IS
	 * that row's anatomy and tracks: status mark 16 · app glyph + name · sentence (state verb, tier chip, build → build) · who · age,
	 * 48px, columns at the same x in every row, one hairline between rows. The only addition is the disclosure the feed needs (the
	 * environments the release reached and the commits under it): a 32px chevron at the row's right, the tab History's expand
	 * affordance, instead of a "Details" text line under every row. Rows without details keep the slot empty so ages stay aligned.
	 * PHONE (< 700px of the card): app · age · chevron on line 1, the sentence on line 2, the person on line 3 (DayRow's order).
	 * People avatars stay neutral; only the verb and the mark take state ink, and only while the failure is current (`live`).
	 */
	import type { Snippet } from 'svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import DeployMark from '$lib/components/DeployMark.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { ChevronDownOutline } from 'flowbite-svelte-icons';
	import type { NodeState } from '$lib/view-models/promotion-lanes';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import type { Actor } from '$lib/actor';

	let {
		app,
		href,
		verb,
		tone = null,
		live = true,
		chip = null,
		theme = null,
		envText = null,
		from = null,
		to = null,
		actor = null,
		age,
		expandable = false,
		open = false,
		ontoggle,
		toggleLabel = 'Show details',
		outcome = null,
		bare = false,
		mark = null,
		children
	}: {
		app: string;
		href: string;
		/** Already phrased for an app subject ("failed its health check", "was promoted"). */
		verb: string;
		tone?: NodeState | null;
		/** A failure that is no longer the rollout's current state reads neutral. */
		live?: boolean;
		/** One environment: its tier chip. */
		chip?: string | null;
		theme?: EnvironmentTheme | null;
		/** Several environments: plain joined text instead of a chip. */
		envText?: string | null;
		from?: string | null;
		to?: string | null;
		/** Only a person is shown (neutral avatar + name); automatic rows leave the column empty. */
		actor?: Actor | null;
		age: string;
		expandable?: boolean;
		open?: boolean;
		ontoggle?: () => void;
		toggleLabel?: string;
		outcome?: string | null;
		/** The page IS the app (/apps/<name>'s Recent activity): the app glyph and name column is dropped, the verb is the row's lead word. */
		bare?: boolean;
		/** A person pressed deploy: manual, or override when it went past a holding gate (QA #14). */
		mark?: 'manual' | null;
		children?: Snippet;
	} = $props();

	const ref = $derived(from && to ? `${from} → ${to}` : (to ?? ''));
	const resolved = $derived(tone === 'failed' && !live);
	const INK: Partial<Record<NodeState, string>> = {
		failed: 'text-danger',
		stuck: 'text-warning',
		held: 'text-held',
		deploying: 'text-active',
		checking: 'text-progress'
	};
	const verbInk = $derived(resolved ? 'text-fg-subtle' : tone ? (INK[tone] ?? 'text-fg-muted') : bare ? 'text-fg' : 'text-fg-muted');
</script>

<li class="fr tap-zone" class:fr-bare={bare} data-feed-row data-tone={tone ?? 'ok'} title={outcome ?? undefined}>
	<div class="fr-in">
		<span class="fr-mk">
			{#if tone}<StatusMark state={tone} label="{app}: {verb}" {resolved} />{:else}<span class="fr-dot" aria-hidden="true"></span>{/if}
		</span>
		{#if !bare}<div class="fr-id">
			<AppGlyph name={app} size={20} />
			<a {href} class="tap-link fr-nm">{app}</a>
		</div>{/if}
		<p class="fr-what">
			<span class="fr-v {verbInk}">{verb}</span>{#if mark}<span class="fr-man"><DeployMark {mark} /></span>{/if}
			{#if chip}<span class="fr-chip"><Chip role="env" {theme} label={chip} /></span>{:else if envText}<span class="fr-env t-meta">{envText}</span>{/if}
			{#if to}<span class="fr-ref t-code-sm" title={ref}>{#if from}<span class="fr-from">{from}</span><span class="fr-arr">&nbsp;→&nbsp;</span><span class="fr-to">{to}</span>{:else}<span class="fr-to">{to}</span>{/if}</span>{/if}
			{#if actor}<span class="fr-who-in t-meta" title={actor.name}><Avatar name={actor.name} src={actor.src} kind={actor.kind} size={16} /><span class="fr-who-n">{actor.name}</span></span>{/if}
		</p>
		<span class="fr-who t-meta">
			{#if actor}<Avatar name={actor.name} src={actor.src} kind={actor.kind} size={16} /><span class="fr-who-n">{actor.name}</span>{/if}
		</span>
		<span class="fr-age t-meta">{age}</span>
		<span class="fr-ch">
			{#if expandable}
				<button type="button" class="fr-tg" aria-expanded={open} aria-label={open ? 'Hide details' : toggleLabel} onclick={ontoggle}>
					<ChevronDownOutline class="h-4 w-4 transition-transform {open ? 'rotate-180' : ''}" aria-hidden="true" />
				</button>
			{/if}
		</span>
	</div>
	{#if open && children}
		<div class="fr-detail">{@render children()}</div>
	{/if}
</li>

<style>
	.fr { position: relative; padding: 0 16px; min-width: 0; list-style: none; }
	.fr:hover { background: var(--k-hover); }
	.fr-in { display: grid; grid-template-columns: 16px minmax(9rem, 11.5rem) minmax(0, 1fr) 2.5rem 32px; column-gap: 12px; align-items: center; min-height: 48px; padding: 8px 0; border-top: 1px solid var(--k-line-subtle); box-sizing: border-box; }
	:global(.lc-rows > .fr:first-child) .fr-in { border-top: 0; }
	.fr-mk { display: grid; place-items: center; width: 16px; }
	.fr-dot { width: 6px; height: 6px; border-radius: 9999px; background: var(--k-fg-disabled); }
	.fr-id { display: flex; align-items: center; gap: 8px; min-width: 0; }
	.fr-nm { font-size: 14px; line-height: 20px; font-weight: 600; letter-spacing: -0.004em; color: var(--k-fg); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.fr-nm:hover { text-decoration: underline; }
	.fr-what { font-size: 14px; line-height: 20px; color: var(--k-fg-muted); margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 8px; }
	.fr-v { font-weight: 500; flex: none; }
	.fr-man { flex: none; display: inline-flex; }
	.fr-chip { flex: none; display: inline-flex; }
	.fr-env { color: var(--k-fg-subtle); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.fr-ref { color: var(--k-fg-subtle); flex: 0 1 auto; display: flex; min-width: 0; overflow: hidden; }
	/* the build the row is ABOUT never truncates; the build it came from gives way first (QA #14) */
	.fr-from { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.fr-to { flex: none; white-space: pre; }
	.fr-arr { flex: none; white-space: pre; }
	.fr-who { display: none; align-items: center; gap: 6px; color: var(--k-fg-muted); min-width: 0; }
	.fr-who-in { display: inline-flex; align-items: center; gap: 6px; color: var(--k-fg-muted); min-width: 0; flex: none; margin-left: auto; }
	.fr-who-n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.fr-age { color: var(--k-fg-subtle); text-align: right; font-variant-numeric: tabular-nums; }
	.fr-ch { display: grid; place-items: center; width: 32px; }
	.fr-tg { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 6px; color: var(--k-fg-subtle); }
	.fr-tg:hover { background: var(--k-hover); color: var(--k-fg); }
	.fr-detail { padding: 0 0 12px 32px; border-top: 0; }
	/* wide cards (≥ 820px) give the person their own column at the same x in every row; below it the person trails the sentence */
	@container (min-width: 820px) {
		.fr-in { grid-template-columns: 16px minmax(9rem, 13rem) minmax(0, 1fr) minmax(5rem, 9rem) 2.5rem 32px; column-gap: 16px; }
		.fr-who { display: flex; }
		.fr-who-in { display: none; }
	}
	/* the middle width (card 601-819px: the Activity list beside its rail at 1440): the sentence wraps and the person goes to its own line,
	   name printed, exactly as on the phone (QA #14 round 2: the person's name must be visible at 1440). */
	@container (min-width: 601px) and (max-width: 819px) {
		/* QA2 #13: the app column stops at 11.5rem (the longest app name needs ~184px) so the sentence keeps the width, and the build it came from
		   WRAPS to its own line rather than truncating to "96d3c…" while the row has room */
		.fr-in { grid-template-columns: 16px minmax(9rem, 11.5rem) minmax(0, 1fr) 2.5rem 32px; }
		.fr-ref { flex: 0 0 auto; min-width: max-content; }
		.fr-what { flex-wrap: wrap; white-space: normal; row-gap: 2px; overflow: visible; }
		.fr-who-in { margin-left: 0; flex-basis: 100%; }
	}
	@container (max-width: 600px) {
		.fr-in { grid-template-columns: 16px minmax(0, 1fr) auto 32px; row-gap: 2px; padding: 12px 0; column-gap: 12px; }
		.fr-mk { align-self: start; margin-top: 2px; grid-row: 1; }
		.fr-id { grid-column: 2; grid-row: 1; }
		.fr-age { grid-column: 3; grid-row: 1; }
		.fr-ch { grid-column: 4; grid-row: 1; margin: -6px 0; }
		.fr-what { grid-column: 2 / 5; grid-row: 2; flex-wrap: wrap; white-space: normal; row-gap: 2px; }
		.fr-detail { padding-left: 28px; }
		.fr-who-in { margin-left: 0; }
	}
	/* bare (the app's own page): mark | sentence | who | age | chevron, the same tracks minus the app column; the verb leads and reads as the row's title */
	.fr-bare .fr-in { grid-template-columns: 16px minmax(0, 1fr) 2.5rem 32px; }
	@container (min-width: 820px) { .fr-bare .fr-in { grid-template-columns: 16px minmax(0, 1fr) minmax(5rem, 9rem) 2.5rem 32px; } }
	@container (max-width: 600px) {
		.fr-bare .fr-in { grid-template-columns: 16px minmax(0, 1fr) auto 32px; }
		.fr-bare .fr-what { grid-column: 2; grid-row: 1; flex-wrap: wrap; }
		.fr-bare .fr-age { grid-row: 1; }
		.fr-bare .fr-mk { align-self: center; margin-top: 0; }
	}
</style>
