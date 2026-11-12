<svelte:options runes={true} />

<script lang="ts">
	/**
	 * r34 r3-approve — THE ONE APPROVE CONFIRM AND ITS AFTER-STATE. Mounted once in the root layout; every Approve button in the product
	 * (`ApproveButton`, or an `Act` from `approveAct`) opens it.
	 *
	 * Role: one confirmation step, in the same surface, naming the build and the places ("Approve f4a2c19 for 5 prod regions?"), then the
	 * after-state: the item has already moved to Deploying on every page, and a toast says "Approved f4a2c19 · payments-core is deploying to 5 prod
	 * regions" with Undo for 8 s. Why no existing component fits: ActRow's "⋯" menu is a list of verbs, Toast is a confirmation of something done
	 * (it is reused here for the after-state), and the product has no confirm-with-a-sentence popover; the deploy dialog is a different job
	 * (an approval never opens it: approval-never-deploys.test.ts). References: the overlay surface of Toast / ActRow's menu (`bg-overlay`,
	 * 8px radius, overlay shadow), `.btn-primary` + `.btn-secondary` for Approve / Cancel, `t-ui` / `t-meta` for the sentence and its detail.
	 * Desktop (>= 640): anchored under (or over, near the viewport foot) the pressed control. Phone: a bottom sheet with 44px buttons.
	 */
	import { onMount, tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { approvePlace, ownCard } from './approve-place';
	import Toast from '$lib/components/Toast.svelte';
	import { approvalUi, cancelApprove, closeApprove, refreshAnchor, confirmApprove, undoApprove, dismissDone, askSentence, doneWords, pauseDone, resumeDone } from './approvals.svelte';

	const ask = $derived(approvalUi.ask);
	const done = $derived(approvalUi.done);
	let panel: HTMLElement | undefined = $state();
	/** the panel's measured height (0 until measured): kept by a ResizeObserver so the above/below flip never reads a stale height inside a $derived */
	let panelH = $state(0);
	let vw = $state(1024);
	let vh = $state(800);
	const phone = $derived(vw < 640);

	const style = $derived.by(() => {
		const a = ask?.anchor;
		if (phone || !a) return '';
		const m = typeof document === 'undefined' ? null : document.querySelector('main')?.getBoundingClientRect();
		const p = approvePlace(a, vw, vh, m && m.width > 0 ? { left: m.left, right: m.right } : null, undefined, ownCard(ask?.trigger ?? null), panelH || undefined);
		const below = 'top' in p;
		return `left:${p.left}px;width:${p.width}px;${below ? `top:${p.top}px` : `bottom:${p.bottom}px`}`;
	});

	$effect(() => {
		const el = panel;
		if (!el) { panelH = 0; return; }
		const measure = () => { panelH = el.offsetHeight; };
		measure();
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});
	$effect(() => {
		if (ask) tick().then(() => panel?.querySelector<HTMLButtonElement>('[data-action="approve-confirm"]')?.focus());
	});
	// After Approve the trigger may be gone (the row moved to Deploying), so focus goes to the toast's own action, never BODY.
	$effect(() => {
		if (!done) return;
		let tries = 0;
		const grab = () => {
			const el = document.querySelector<HTMLButtonElement>('[data-action="approve-undo"], [data-action="approve-dismiss"]');
			if (el) el.focus();
			else if (tries++ < 10) raf = requestAnimationFrame(grab);
		};
		let raf = requestAnimationFrame(grab);
		return () => cancelAnimationFrame(raf);
	});
	onMount(() => {
		const away = (e: PointerEvent) => { if (approvalUi.ask && panel && !panel.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-approve-open]')) closeApprove(); };
		document.addEventListener('pointerdown', away, true);
		return () => document.removeEventListener('pointerdown', away, true);
	});
	function key(e: KeyboardEvent) {
		if (e.key === 'Escape' && approvalUi.ask) { e.stopPropagation(); cancelApprove(); }
		else if (e.key === 'Escape' && approvalUi.done && !e.defaultPrevented && !document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) dismissDone(); // another overlay already took this Escape
	}
</script>

<svelte:window onscrollcapture={refreshAnchor} bind:innerWidth={vw} bind:innerHeight={vh} onkeydown={key} />

{#if ask}
	{@const t = ask.target}
	{#if phone}<div class="fixed inset-0 z-[69] bg-black/40" transition:fade={{ duration: 120 }} aria-hidden="true"></div>{/if}
	<div
		bind:this={panel}
		role="dialog"
		aria-modal={phone ? 'true' : undefined}
		aria-label={askSentence(t)}
		data-approve-confirm
		class="fixed z-[70] flex flex-col gap-3 bg-overlay p-4 {phone ? 'inset-x-2 bottom-2 rounded-lg pb-[calc(env(safe-area-inset-bottom,0px)+16px)]' : 'rounded-md'}"
		style="box-shadow: var(--k-shadow-overlay); {style}"
		transition:fly={{ y: phone ? 24 : 6, duration: 140 }}
	>
		<div class="min-w-0">
			<div class="t-ui font-medium text-fg">{askSentence(t)}</div>
			<div class="t-meta mt-0.5 text-fg-muted">{t.app} · {t.places.map((p) => (p.label === 'prod' ? 'production' : p.label)).join(', ')}</div>
		</div>
		<div class="flex items-center justify-end gap-2">
			<button type="button" class="btn btn-secondary btn-sm {phone ? 'min-h-11 flex-1' : ''}" data-action="approve-cancel" onclick={cancelApprove}>Cancel</button>
			<button type="button" class="btn btn-primary btn-sm {phone ? 'min-h-11 flex-1' : ''}" data-action="approve-confirm" onclick={() => confirmApprove()}>Approve</button>
		</div>
	</div>
{/if}

{#if done}
	{@const w = doneWords(done.target)}
	<div role="presentation" data-approve-toast title={done.still?.title} onpointerover={() => pauseDone('hover')} onpointerout={() => resumeDone('hover')} onfocusin={() => pauseDone('focus')} onfocusout={() => resumeDone('focus')} style="display: contents">
	<Toast
		bind:open={() => true, (v) => { if (!v) dismissDone(); }}
		tone={done.error ? 'danger' : done.still ? 'info' : 'success'}
		message={done.error ? `Could not ${done.undo ? 'undo' : 'approve'} ${done.target.build}` : done.still ? `${done.target.build} stays approved` : `${w.title} · ${w.detail}`}
		description={done.error ?? (done.still ? `Another approval stands${done.still.who ? `, by ${done.still.who}` : ''}` : '')}
	>
		{#snippet action()}
			{#if done.error}
				<button type="button" class="nav-link" data-action="approve-dismiss" onclick={dismissDone}>Dismiss</button>
			{:else if done.still}
				<button type="button" class="nav-link" data-action="approve-dismiss" onclick={dismissDone}>Dismiss</button>
			{:else}
				<button type="button" class="nav-link" data-action="approve-undo" onclick={() => undoApprove()}>Undo</button>
			{/if}
		{/snippet}
	</Toast>
	</div>
{/if}
