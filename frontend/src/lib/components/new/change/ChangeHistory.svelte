<script lang="ts">
	/**
	 * THE CHANGE'S STORY (change-strip r2; owner 2026-11-12: "main thing 'history' cards is pretty bland"). An activity feed, NEWEST FIRST
	 * (owner, as the rollout History tab reads), the life read upwards:
	 * merged -> released -> deployed to each tier (prod: one event per WAVE, its sites named) -> checking / held / waiting / failed /
	 * rolled back. The environment strip in the header owns the at-a-glance progression; History tells the story with detail.
	 * ROW: [coloured mark] verb in its state ink · env chip (tier identity) · the sites of a wave / the app | age
	 *      line 2: build (mono) · who (avatar + login, "Automatic" is silent) · cause · the link (PR / CI run / rollout) | "+2h 10m" since the
	 *      event before it. One emphasis per tier: verb (t-ui), facts (t-meta muted), clocks (t-meta subtle tabular).
	 * MARKS: deployed = the tabs' success check (BakeStatusIcon Succeeded, green); in flight = StatusMark checking / deploying; held /
	 * waiting = StatusMark held / approval; failed = the one solid disc; merged / released / rolled back = the kind marks.
	 * REFERENCES: GitHub's PR timeline (event icon, actor, link), Linear's issue activity (one line, quiet clock), Vercel's deployment events
	 * (state colour on the mark only), the rollout History tab's spine (`ledgerSpine`) and its row rhythm (16px mark column, py-3).
	 * The row is a `.tap-zone`; its ONE `.tap-link` is the visible link on line 2 (no second control for the same destination).
	 */
	import { ClockOutline, ArrowUpRightFromSquareOutline, ChevronRightOutline } from 'flowbite-svelte-icons';
	import ChangeKindMark from './ChangeKindMark.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import { ledgerSpine } from '$lib/ledger-spine';
	import { avatarSrc, ago } from '../data';
	import { envTheme } from '../rollout-view';
	import { isViewer, clock, span } from '../change-view';
	import { foldWindow, type Ev } from './detail-model';

	let {
		events,
		multiApp = false,
		headBuild = null,
		ciHref = null,
		class: className = ''
	}: {
		events: Ev[];
		/** the header's build: an event prints its build id only when it differs */
		headBuild?: string | null;
		/** a change in several apps names the app on every row */
		multiApp?: boolean;
		/** the CI run of the change's build (the Released event links it) */
		ciHref?: string | null;
		class?: string;
	} = $props();
	const FOLD = 10;
	let open = $state(false);
	const gap = $derived(open ? null : foldWindow(events, FOLD));
	const shown = $derived(events.map((e, i) => ({ e, i })).filter((x) => !gap || x.i < gap[0] || x.i >= gap[1]));
	const hidden = $derived(gap ? gap[1] - gap[0] : 0);
	const INK: Partial<Record<Ev['kind'], string>> = { waiting: 'text-held', held: 'text-held', failed: 'text-danger' };
	const verbInk = (e: Ev) => INK[e.kind] ?? (e.kind === 'moving' ? (/checking/i.test(e.words) ? 'text-progress' : 'text-active') : 'text-fg');
	/** newest first: the time since the event BELOW it (the one before it in time), on the clock the ages read ("+2h 10m"); none on the oldest */
	const delta = (i: number) => {
		const a = events[i + 1]?.at, b = events[i]?.at;
		if (!a || !b) return '';
		const ms = Date.parse(b) - Date.parse(a);
		return ms >= 60_000 ? '+' + (ms >= 86_400_000 ? Math.floor(ms / 86_400_000) + 'd' : span(ms)) : '';
	};
	const linkOf = (e: Ev): { text: string; href: string; ext: boolean } | null =>
		e.kind === 'merged' && e.href ? { text: e.words === 'Committed' ? 'Commit' : 'Pull request', href: e.href, ext: true }
		: e.kind === 'released' && ciHref ? { text: 'CI run', href: ciHref, ext: true }
		: e.href ? { text: 'Rollout', href: e.href, ext: false } : null;
	const sitesText = (e: Ev) => (e.tier === 'prod' && (e.wave != null || e.places.length > 1) ? e.places.map((p) => p.label).join(', ') : '');
	const showWho = (e: Ev) => !!e.who && e.who !== 'Automatic';
</script>

<Card class={className} icon={ClockOutline} title="History" verdict="{events.length} events" padded={false}>
	<ul class="cdh divide-y divide-line-subtle" data-change-history use:ledgerSpine>
		{#each shown as { e, i } (e.key)}
			{#if gap && i === gap[1]}
				<li class="cdh-fold py-2 pl-[44px] pr-4"><button type="button" class="btn btn-secondary btn-xs relative z-[2] max-sm:min-h-11" aria-expanded={open} onclick={() => (open = true)}>Show {hidden} more</button></li>
			{/if}
			{@const ln = linkOf(e)}
			{@const sites = sitesText(e)}
			{@const dt = delta(i)}
			<li data-ev={e.kind} data-place={e.place ?? undefined}>
				<div class="cdh-row tap-zone min-h-14 px-4 py-3 hover:bg-hover">
					<span class="cdh-mark flex h-5 shrink-0 items-center justify-center" data-spine-mark>
						{#if e.kind === 'released'}<ChangeKindMark kind="build" label="Released" />
						{:else if e.kind === 'merged'}<ChangeKindMark kind={e.words === 'Committed' ? 'commit' : 'merge'} label={e.words} />
						{:else if e.kind === 'rollback'}<ChangeKindMark kind="rollback" label="Rolled back" />
						{:else if e.kind === 'deployed' || e.kind === 'redeploy'}<BakeStatusIcon bakeStatus="Succeeded" size="small" />
						{:else if e.kind === 'moving'}<StatusMark state={/checking/i.test(e.words) ? 'checking' : 'deploying'} />
						{:else if e.kind === 'waiting'}<StatusMark state="approval" tone="held" />
						{:else if e.kind === 'held'}<StatusMark state="held" />
						{:else}<StatusMark state="failed" />{/if}
					</span>
					<span class="cdh-l1 flex min-h-5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<span class="t-ui whitespace-nowrap {verbInk(e)}" data-ev-verb>{e.words}</span>
						{#if e.tier && (e.kind === 'deployed' || e.kind === 'moving' || e.kind === 'redeploy')}<Chip role="env" theme={envTheme(e.tier)} label={e.tier} />{/if}
						{#if sites}<span class="t-meta min-w-0 truncate text-fg-muted" data-ev-sites title={sites}>{sites}</span>{/if}
						{#if multiApp && e.app}<span class="t-meta inline-flex shrink-0 items-center gap-1 text-fg-muted" data-ev-app><AppGlyph name={e.app} size={16} class="shrink-0" />{e.app}</span>{/if}
					</span>
					<span class="cdh-age t-meta flex h-5 items-center justify-end whitespace-nowrap tabular-nums text-fg-subtle" title={clock(e.at)} data-ev-age>{ago(e.at)}</span>
					<span class="cdh-l2 t-meta flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-fg-muted">
						{#if e.build && (e.build !== headBuild || e.kind === 'deployed' || e.kind === 'moving')}<span class="t-code-sm whitespace-nowrap text-fg-muted" data-ev-build>{e.build}</span>{/if}
						{#if showWho(e)}<span class="inline-flex min-w-0 items-center gap-1.5" data-ev-who>{#if !isViewer(e.who)}<Avatar name={e.who ?? ''} src={avatarSrc(e.who ?? '')} size={16} />{/if}<span class="truncate">{isViewer(e.who) ? 'you' : e.who}</span></span>{/if}
						{#if e.cause || e.from}<span class="min-w-0 truncate" data-ev-cause title={[e.from ? `from ${e.from}` : '', e.cause ?? ''].filter(Boolean).join(' · ')}>{[e.from ? `from ${e.from}` : '', e.cause ?? ''].filter(Boolean).join(' · ')}</span>{/if}
						{#if ln}<a href={ln.href} target={ln.ext ? '_blank' : undefined} rel={ln.ext ? 'noopener noreferrer' : undefined} class="tap-link inline-flex items-center gap-1 whitespace-nowrap text-fg-subtle hover:text-fg" data-ev-link>{ln.text}{#if ln.ext}<ArrowUpRightFromSquareOutline class="h-3 w-3" aria-hidden="true" />{:else}<ChevronRightOutline class="h-3 w-3" aria-hidden="true" />{/if}</a>{/if}
					</span>
					<span class="cdh-dt t-meta whitespace-nowrap tabular-nums text-fg-subtle" data-ev-delta>{dt}</span>
				</div>
			</li>
		{/each}
		{#if open && events.length > FOLD}<li class="py-2 pl-[44px] pr-4"><button type="button" class="btn btn-secondary btn-xs relative z-[2] max-sm:min-h-11" aria-expanded={open} onclick={() => (open = false)}>Show fewer</button></li>{/if}
	</ul>
</Card>

<style>
	.cdh { position: relative; isolation: isolate; }
	.cdh::before { content: ''; position: absolute; left: var(--spine-x, 24px); top: var(--spine-top, 0); height: var(--spine-h, 0); width: 1px; background: var(--k-line-strong); z-index: 1; pointer-events: none; }
	.cdh-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; column-gap: 12px; row-gap: 4px; align-items: start; }
	.cdh-mark { grid-row: 1; grid-column: 1; position: relative; z-index: 2; width: 16px; background: var(--k-surface); border-radius: 9999px; box-shadow: 0 0 0 3px var(--k-surface); }
	.cdh-l1 { grid-row: 1; grid-column: 2; }
	.cdh-age { grid-row: 1; grid-column: 3; }
	.cdh-l2 { grid-row: 2; grid-column: 2; }
	.cdh-l2:empty { display: none; }
	.cdh-dt { grid-row: 2; grid-column: 3; justify-self: end; line-height: 16px; }
</style>
