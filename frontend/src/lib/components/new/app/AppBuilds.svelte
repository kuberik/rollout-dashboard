<script lang="ts">
	/**
	 * r34 builds-lag (B) — THE SOUNDING LEDGER: the one card of /apps/<name> that says which build each place runs and how far behind it is.
	 * ROLE (owner, on a phone: "it should be way more clear how behind each environment is. I think it could be incorporated into builds"):
	 * the app's own build sequence, newest first, as the History tab's spine (a stop per build: mono id · commit title · lag · age); every
	 * place stands once, under the build it runs, with its health mark + one state word. How far behind a place is = how many stops sit
	 * above it, counted in THIS app's builds only (app-model ledgerOf, pinned to each place's own tab "Newer builds" count); a build no
	 * place runs is a dim stop (the gap = the lag made visible); runs of >= 4 such stops fold into one grey row; a build outside the
	 * sequence is "Custom build", labelled and never counted.
	 * WHY PLACES MERGED INTO BUILDS: Places and Builds each printed the build, its age and the currency of the same places, so "how far behind"
	 * was said in two cards and visible in neither; one object (a place on a build) cannot honestly sit in two lists. Merged, the lag is
	 * geometry: the distance between the lead stop and the stop a place stands on.
	 * WHY NO EXISTING COMPONENT FITS: the Overview's Newer builds (hand-rolled in a 4,000-line route) lists one place's candidates; BuildRow is
	 * the Revisions ledger row (no places, no Deploy); RolloutRow lists rollouts, not builds. This borrows the History spine (16px mark
	 * column on a 1px line-strong spine) and proportions (44/56px rows) and the Newer-builds disclosure (title, author, PR, Deploy).
	 * Phone (owner §5): a stop = id · lag word · age (one line); a place = mark · chip · state word (one line, wraps if long);
	 * commit title, author, PR and Deploy are one tap on the stop. Time in state is a 1440-only column.
	 * Lineage: shared/builds-mock/mock-A.html "Sounding" (picked), the tab's Newer builds.
	 */
	import Card from '$lib/components/Card.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { CodeOutline, ChevronDownOutline, PlaySolid, MapPinAltOutline } from 'flowbite-svelte-icons';
	import { avatarSrc, type PlaceHold, type TRow, type HomeState } from '../data';
	import { foldLedger, stopWord, stopShort, placeNote, type Stop } from './app-model';
	import PlaceRow from './PlaceRow.svelte';

	export type PlaceView = { row: TRow; pinned: boolean; approve: TRow['action']; slipAction: TRow['action']; toggle: (() => void) | null; open: boolean };
	let { stops, places, view, rollup: roll = '', phone = false, nested = false, hs = 'incident', onDeploy }: { stops: Stop[]; places: PlaceHold[]; /** how each place is drawn (row, pin, the action it owns, its pipeline toggle) */ view: (p: PlaceHold) => PlaceView; rollup?: string; phone?: boolean; nested?: boolean; hs?: HomeState; onDeploy: (place: PlaceHold, build: string) => void } = $props();

	let openStops = $state(new Set<string>());
	let openFolds = $state(new Set<string>());
	const flipIn = (s: Set<string>, k: string) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; };
	const items = $derived(foldLedger(stops, openFolds));
	const total = $derived(places.length);
	const onNewest = $derived(stops[0] && !stops[0].custom ? stops[0].places.length : 0);
	const failing = $derived(places.filter((p) => p.state === 'failed').length);
</script>

<Card icon={CodeOutline} title="Builds" padded={false} class="min-w-0">
	{#snippet rollup()}<span class="t-ui-sm inline-flex items-center gap-x-3 tabular-nums text-fg-subtle">{#if failing}<span class="inline-flex items-center gap-2 whitespace-nowrap text-fg"><span class="h-1.5 w-1.5 rounded-full bg-danger-solid" aria-hidden="true"></span>{failing} failing</span>{/if}<span class="whitespace-nowrap">{roll || `${onNewest} of ${total} ${total === 1 ? 'place' : 'places'} on the newest build`}</span></span>{/snippet}
	{#if stops.length}
		<ul class="ledger relative" data-ledger>
			{#each items as it (it.kind === 'fold' ? `fold:${it.key}` : it.stop.key)}
				{#if it.kind === 'fold'}
					<li class="fold"><button type="button" class="fold-row t-meta tap-zone w-full text-left" onclick={() => (openFolds = flipIn(openFolds, it.key))} aria-expanded="false"><span class="fold-dash" aria-hidden="true"></span><span class="min-w-0 truncate text-fg-subtle">{it.stops.length} builds not running anywhere</span><span class="t-code-sm text-fg-disabled max-sm:hidden">{it.stops[0].build} – {it.stops[it.stops.length - 1].build}</span></button></li>
				{:else}
					{@const s = it.stop}
					{@const open = openStops.has(s.key)}
					<li class="stop-li" class:occ={s.places.length > 0 || s.index === 0} data-truth-kind="build" data-truth-build={s.build} data-truth-author={s.author ?? ''} data-truth-title={s.title ?? ''} data-truth-lag={s.custom ? 'custom' : String(s.index)} data-truth-deploy={s.deployTo.map((p) => p.place).join(',')}>
						<button type="button" class="stop tap-zone" class:empty={!s.places.length} class:custom={s.custom} aria-expanded={open} aria-label="{s.build}, {stopWord(s)}{s.title ? `, ${s.title}` : ''}" onclick={() => (openStops = flipIn(openStops, s.key))}>
							<span class="dot" aria-hidden="true"></span>
							<span class="s-main"><span class="t-code s-id">{s.build}</span><span class="s-lag t-meta" title={!s.places.length && !s.custom && s.index === 0 ? 'Newest · no place yet' : stopWord(s)}>{#if !s.places.length && !s.custom}{s.index === 0 ? 'Newest' : ''}{:else}{stopShort(s)}{/if}</span></span>
							{#if s.title}<span class="s-ttl t-body" title={s.title}>{s.title}</span>{/if}
							<span class="s-age t-meta tabular-nums">{s.age}</span>
							<ChevronDownOutline class="s-cv h-4 w-4 transition-transform {open ? 'rotate-180' : ''}" aria-hidden="true" />
						</button>
						{#if open}
							<div class="disc">
								{#if s.title}<span class="t-body text-fg">{s.title}</span>{/if}
								<span class="t-meta inline-flex flex-wrap items-center gap-x-2 text-fg-muted">{#if s.author}<Avatar name={s.author} src={avatarSrc(s.author)} size={16} />{s.author}{/if}{#if s.pr}<span class="t-code-sm text-fg-subtle">#{s.pr}</span>{/if}{#if !s.title && !s.author}<span class="text-fg-subtle">No details recorded for this build</span>{/if}</span>
								{#each s.deployTo.slice(0, 1) as p (p.href)}<button type="button" class="btn btn-secondary btn-xs gap-2 max-sm:min-h-11 max-sm:px-3.5 max-sm:text-sm" aria-label="Deploy {s.build} to {p.place}" onclick={() => onDeploy(p, s.build)}><PlaySolid class="h-3.5 w-3.5" aria-hidden="true" />Deploy</button>{/each}
							</div>
						{/if}
					</li>
					{#each s.places as p (p.href)}{@const v = view(p)}<PlaceRow row={v.row} place={p} pinned={v.pinned} note={placeNote(s, p)} approve={v.approve} open={v.open} {nested} toggle={v.toggle} {hs} slipAction={v.slipAction} />{/each}
				{/if}
			{/each}
		</ul>
	{:else}
		<div class="flex flex-col items-center gap-1 px-4 py-6 text-center">
			<MapPinAltOutline class="h-5 w-5 text-fg-disabled" aria-hidden="true" />
			<p class="t-ui text-fg">No place runs this app yet</p>
			<p class="t-meta text-fg-subtle">Builds appear once a rollout deploys it.</p>
		</div>
	{/if}
</Card>

<style>
	.ledger { padding-block: 4px; }
	/* the History spine: a 1px line-strong rule through the 16px mark column (x 24) */
	.ledger::before { content: ''; position: absolute; left: 23.5px; top: 22px; bottom: 22px; width: 1px; background: var(--k-line-strong); }
	.stop-li { position: relative; }
	.stop-li.occ { margin-top: 4px; }
	.stop-li.occ:not(:first-child)::before { content: ''; position: absolute; left: 44px; right: 0; top: -4px; border-top: 1px solid var(--k-line-subtle); }
	.stop { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto 16px; column-gap: 8px; align-items: center; width: 100%; min-height: 40px; padding: 4px 16px; text-align: left; position: relative; }
	.stop:hover { background: var(--k-hover, transparent); }
	.dot { width: 8px; height: 8px; border-radius: 999px; justify-self: center; background: var(--k-fg); box-shadow: 0 0 0 3px var(--k-surface, transparent); position: relative; z-index: 1; }
	.stop.empty .dot { background: var(--k-surface, transparent); box-shadow: inset 0 0 0 1px var(--k-line-strong), 0 0 0 3px var(--k-surface, transparent); }
	.stop.custom .dot { background: var(--k-surface, transparent); box-shadow: inset 0 0 0 1px var(--k-fg-muted), 0 0 0 3px var(--k-surface, transparent); }
	.stop.empty { min-height: 32px; }
	.s-main { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 12px; row-gap: 0; min-width: 0; margin-left: 4px; }
	.s-id { color: var(--k-fg); }
	.stop.empty .s-id { color: var(--k-fg-subtle); }
	.s-lag { color: var(--k-fg-subtle); white-space: nowrap; }
	.stop { grid-template-rows: auto; }
	.s-main { grid-column: 2; grid-row: 1; }
	.s-age { grid-column: 3; grid-row: 1; }
	.stop :global(.s-cv) { grid-column: 4; grid-row: 1; }
	/* phone: the title is its own line under id · lag, at the id's x, clamped to 2 lines (never silently dropped) */
	.s-ttl { grid-column: 2 / 4; grid-row: 2; margin-left: 4px; color: var(--k-fg-muted); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; min-width: 0; overflow-wrap: anywhere; }
	.stop.empty .s-ttl { color: var(--k-fg-subtle); }
	.s-age { color: var(--k-fg-muted); text-align: right; min-width: 32px; }
	.stop :global(.s-cv) { color: var(--k-fg-subtle); }
	.disc { display: grid; gap: 4px; justify-items: start; padding: 0 16px 8px 48px; }
	.fold-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; column-gap: 8px; align-items: center; min-height: 32px; padding: 0 16px; background: var(--k-subtle); }
	.fold-dash { width: 8px; height: 1px; justify-self: center; background: var(--k-fg-disabled); }
	@container (min-width: 560px) {
		.stop { grid-template-columns: 16px 96px minmax(0, 1fr) 64px 40px 16px; }
		.s-main { display: contents; }
		.s-id { grid-column: 2; grid-row: 1; margin-left: 4px; }
		.s-ttl { display: block; grid-column: 3; grid-row: 1; margin-left: 0; white-space: nowrap; text-overflow: ellipsis; -webkit-line-clamp: unset; line-clamp: unset; }
		.s-lag { grid-column: 4; grid-row: 1; text-align: right; }
		.s-age { grid-column: 5; grid-row: 1; }
		.stop :global(.s-cv) { grid-column: 6; grid-row: 1; }
	}
</style>
