<script lang="ts">
	/**
	 * THE PR'S LIFE (r34 v2 CD r2, rail) — History as the rollout tab's History draws it: a spine through a status column, one row per
	 * EVENT of this change in the History tab's own clock, oldest first so it reads as a life: merged → released → reached production →
	 * failed / rolled back → what still waits (cs3: History never redraws the progression: no per-place deploy rows, no env chips; the
	 * Stages card owns that; places are named in words). Rows carry who did it (Avatar + login;
	 * "Automatic" when no person; never the viewer's own face). REFERENCE: History's ledger spine (`ledgerSpine`, 1px line-strong
	 * through the marks, a 3px ring of the card ground) and its row (mark · build mono · chip · outcome · who · time).
	 * NEW BY DESIGN: the row is an event of a CHANGE across places, not a deploy of one rollout. A whole row is one link (to that
	 * place's History / Gates; the merge to the PR), >= 44px at 390. Folds at six rows like the Landed card did.
	 * v2 r5: a CHECKING event wears the tab's clock (StatusMark `checking`, hue 78), the glyph the Places row wears; a rollback keeps its build at 390
	 * ("Rolled back to a11c202 · us-east" says to what); avatar initials are 11px (size 24).
	 * GAP (data): opened / built times are not in the model (changes carry mergedAt only), so the spine starts at the merge.
	 */
	import { ClockOutline } from 'flowbite-svelte-icons';
	import ChangeKindMark from './ChangeKindMark.svelte';
	import Card from '$lib/components/Card.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
		import Avatar from '$lib/components/Avatar.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import { ledgerSpine } from '$lib/ledger-spine';
	import { avatarSrc, ago } from '../data';
	import { isViewer, clock } from '../change-view';
	import { foldWindow, type Ev } from './detail-model';

	let { events, multiApp = false, headBuild = null, class: className = '' }: { events: Ev[]; /** the header's build: an event prints its build id only when it differs */ headBuild?: string | null; /** AD r5 N2: a change in two apps names the app on every row (fixed slot before the badge) */ multiApp?: boolean; class?: string } = $props();
	const FOLD = 10;
	let open = $state(false);
	/* changedetail-10 CF4: the fold is ONE contiguous window of the chronological list ("Show N more" sits where the hidden rows are, between two visible runs); the merge on top, every failure, the first live row and the newest rows stay outside it */
	const gap = $derived(open ? null : foldWindow(events, FOLD));
	const shown = $derived(events.map((e, i) => ({ e, i })).filter((x) => !gap || x.i < gap[0] || x.i >= gap[1]));
	const hidden = $derived(gap ? gap[1] - gap[0] : 0);
	/* the fold button sits where the first hidden row would be */
	const foldAt = $derived(gap ? gap[0] : -1);
	const MARK: Record<Ev['kind'], string> = { failed: 'failed', deployed: 'newest', moving: 'deploying', redeploy: 'newest', rollback: 'behind', waiting: 'held', held: 'held', merged: 'none', released: 'none' };
</script>

<Card class={className} icon={ClockOutline} title="History" verdict="{events.length} events" padded={false}>
	<ul class="cdh divide-y divide-line-subtle" data-change-history use:ledgerSpine>
		{#each shown as { e, i } (e.key)}
			{#if gap && i === gap[1]}
				<li class="cdh-fold py-2 pl-[44px] pr-4"><!-- r11 CH4: the fold button starts at the rows' text x (16 pad + 16 mark + 12 gap) --><button type="button" class="btn btn-secondary btn-xs relative z-[2] max-sm:min-h-11" aria-expanded={open} onclick={() => (open = true)}>Show {hidden} more</button></li>
			{/if}
			<li data-ev={e.kind} data-place={e.place ?? undefined}>
				<!-- P1 (owner §7, changedetail-10 CF6): the verb is its own FIXED track, so the chips start at ONE x on every row; in a narrow rail (and on a phone) the chips take line 2 at the text x. Line 3 (wide only): the build in mono, the actor right. -->
				<svelte:element this={e.href ? 'a' : 'div'} href={e.href ?? undefined} target={e.kind === 'merged' ? '_blank' : undefined} rel={e.kind === 'merged' ? 'noopener' : undefined} class="cdh-row tap-zone min-h-14 px-4 py-3 hover:bg-hover">
					<span class="cdh-mark flex h-5 shrink-0 items-center justify-center" data-spine-mark>{#if e.kind === 'released'}<ChangeKindMark kind="build" label="Released" />{:else if e.kind === 'merged'}<ChangeKindMark kind={e.words === 'Committed' ? 'commit' : 'merge'} label={e.words} />{:else if e.kind === 'rollback'}<ChangeKindMark kind="rollback" label="Rolled back" />{:else if e.kind === 'deployed' || e.kind === 'redeploy'}<ChangeKindMark kind={e.words === 'Reached prod' ? 'live' : 'deploy'} label={e.words} />{:else}<StatusMark state={(e.kind === 'moving' && e.words === 'Checking' ? 'checking' : MARK[e.kind]) as never} />{/if}</span>
					<span class="cdh-verb t-ui flex min-h-5 items-center gap-x-2 {e.kind === 'waiting' || e.kind === 'held' ? 'text-held' : e.kind === 'failed' ? 'text-danger' : e.kind === 'moving' ? (e.words === 'Checking' ? 'text-progress' : 'text-active') : 'text-fg'}" data-ev-verb>{e.words}</span>
					{#if (multiApp && e.app) || (e.build && e.build !== headBuild)}<span class="cdh-chips flex min-h-5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{#if multiApp && e.app}<span class="t-meta inline-flex shrink-0 items-center gap-1 text-fg-muted" data-ev-app><AppGlyph name={e.app} size={16} class="shrink-0" />{e.app}</span>{/if}{#if e.build && e.build !== headBuild}<span class="cdh-pid t-code-sm text-fg-muted">{e.build}</span>{/if}</span>{/if}
					<span class="cdh-age t-meta flex h-5 items-center justify-end whitespace-nowrap tabular-nums text-fg-subtle" title={clock(e.at)} data-ev-age>{ago(e.at)}</span>
					<span class="cdh-l2 {e.cause || e.from ? 'cdh-l2c' : ''} flex min-w-0 items-center justify-between gap-3">
						<span class="cdh-l2b t-code-sm whitespace-nowrap text-fg-muted">{e.build && e.build !== headBuild ? e.build : ''}</span>
						{#if e.cause || e.from}<span class="t-meta min-w-0 flex-1 truncate text-fg-muted" data-ev-cause title={[e.from ? `from ${e.from}` : '', e.cause ?? ''].filter(Boolean).join(' · ')}>{[e.from ? `from ${e.from}` : '', e.cause ?? ''].filter(Boolean).join(' · ')}</span>{/if}
						{#if e.who && e.who !== 'Automatic' && !(e.kind === 'merged' && isViewer(e.who))}<span class="cdh-l2w t-meta flex min-w-0 items-center gap-1.5 text-fg-subtle">{#if !isViewer(e.who)}<Avatar name={e.who} src={avatarSrc(e.who)} size={24} />{/if}<span class="truncate">{isViewer(e.who) ? 'you' : e.who}</span></span>{/if}
					</span>
				</svelte:element>
			</li>
		{/each}
		{#if open && events.length > FOLD}<li class="py-2 pl-[44px] pr-4"><button type="button" class="btn btn-secondary btn-xs relative z-[2] max-sm:min-h-11" aria-expanded={open} onclick={() => (open = false)}>Show fewer</button></li>{/if}
	</ul>
</Card>

<style>
	.cdh { position: relative; isolation: isolate; }
	.cdh::before { content: ''; position: absolute; left: var(--spine-x, 24px); top: var(--spine-top, 0); height: var(--spine-h, 0); width: 1px; background: var(--k-line-strong); z-index: 1; pointer-events: none; }
	.cdh { container: cdh / inline-size; }
	/* narrow rail / phone: line 1 verb + age, line 2 the chips at the text x (a rollback names its build beside the verb); the wide layout adds the build / actor line */
	.cdh-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; column-gap: 12px; row-gap: 4px; align-items: start; }
	.cdh-mark { grid-row: 1; grid-column: 1; } .cdh-verb { grid-row: 1; grid-column: 2; } .cdh-age { grid-row: 1; grid-column: 3; } .cdh-chips { grid-row: 2; grid-column: 2 / 4; } .cdh-l2 { display: none; grid-column: 2 / 4; }
	/* r11 CH4: at 390 every row's build id sits in ONE slot (the end of line 2, after the chips); from 400 it is the third line's mono slot */
	.cdh-pid { margin-left: auto; }
	.cdh-mark { position: relative; z-index: 2; width: 16px; }
	/* r13 CE5: a rollback's cause ("from a11c303 · duplicate invoice numbers") shows from 640 even in the narrow rail (its build is already in the chip line there) */
	@media (min-width: 640px) { .cdh-l2c { display: flex; grid-row: 3; } .cdh-l2c .cdh-l2b, .cdh-l2c .cdh-l2w { display: none; } }
	@container cdh (min-width: 400px) {
		.cdh-l2c .cdh-l2b, .cdh-l2c .cdh-l2w { display: flex; }
		.cdh-row { grid-template-columns: 16px 148px minmax(0, 1fr) auto; }
		.cdh-verb { grid-column: 2; } .cdh-chips { grid-row: 1; grid-column: 3; } .cdh-age { grid-column: 4; }
		.cdh-l2 { display: flex; grid-row: 2; grid-column: 2 / 5; } .cdh-l2:empty { display: none; } .cdh-pid { display: none; }
	}
	/* the card-ground halo that hides the spine behind a mark is the mark COLUMN's, never the mark's own (a StatusMark's ring IS a box-shadow: a halo on it erased the ring and left 10-12px glyphs, AD r9 U2) */
	.cdh-mark { background: var(--k-surface); border-radius: 9999px; box-shadow: 0 0 0 3px var(--k-surface); }
</style>
