<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ THE CONFIRMATION THE `Retry` BUTTON DID NOT HAVE.
	 *
	 * ── THE DEFECT ───────────────────────────────────────────────────────────
	 * A live critique pressed `Retry` in the red failure banner of a PRODUCTION
	 * rollout. It fired on the first click: no dialog, no mention of production,
	 * no statement that the health check which had just failed was still
	 * failing — and the retry then reset that check to *"Pending — reset due to
	 * new deployment"*, deleting the only readable account of what went wrong.
	 * At the same second, deploying that identical build through `Change
	 * Version` demanded a typed sha with the primary disabled until it matched.
	 * One act, two routes, and the dangerous route was the cheap one.
	 *
	 * ── WHAT THIS IS AND IS NOT ──────────────────────────────────────────────
	 * ⛔ IT IS NOT A TYPED CONFIRM BOLTED ONTO EVERY RETRY. `deploy-risk.ts`
	 * decides, from the same three inputs it already weighs for a manual deploy:
	 * direction, whether the target is production, and whether the gates allow
	 * this build right now. A retry in dev that the rules already allow returns
	 * `none` and never opens this dialog at all — the caller fires immediately,
	 * so a transient failure in dev is still ONE CLICK.
	 *
	 * ⛔ NO STRINGS ARE INVENTED HERE. Every sentence comes off
	 * `retryConsequences`, the label off `deployActionLabel`, the typed prompt
	 * off `typedPrompt`. A component that "improves" one of them re-opens the
	 * defect the view-model exists to close.
	 *
	 * ⭐ ROUND 2 (2026-10-08, design review 4) — ON THE RECOVERY/CLEAR-PIN
	 * SHELL NOW, NOT THE OLD CENTRED-GLYPH CARD. A 48px centred circle was
	 * this file's own pre-language composition; the coordinator's round-2
	 * ruling is that EVERY risk dialog in this lane now shares one shell —
	 * `RecoveryModeWarningModal`'s own (§3.14 header bar: a 40px disc beside
	 * the title, left-aligned, `border-b`) — so a reader who has seen one
	 * risk dialog recognises the next. The consequence list drops its tint:
	 * hue lives in the header disc only, never as a body-wide band (same
	 * rule `RecoveryModeWarningModal` now follows).
	 *
	 * ⭐ ONE VERB, NEUTRAL INK (follow-up): the title is `Retry <build> in <env>?` and the confirm is `Retry`, the word of the button that opened
	 * it. A retry resends a build the place already ran, so the header disc is neutral and the confirm is the product's primary, not a danger
	 * tint; how careful to be stays in the confirm LEVEL (typed in prod), not in the colour.
	 */
	import { Modal } from 'flowbite-svelte';
	import { tick } from 'svelte';
	import StatusSpinner from './StatusSpinner.svelte';
	import { CloseOutline, ExclamationCircleSolid, RefreshOutline } from 'flowbite-svelte-icons';
	import { DIALOG_ERROR_CLASS, retryFailureText } from '$lib/view-models/failure-text';
	import { modalFocusReturn } from '$lib/a11y.svelte';
	import {
		confirmLevel,
		deployActionLabel,
		retryTitle,
		typedPrompt,
		type DeployIntent
	} from '$lib/view-models/deploy-risk';

	interface Props {
		open: boolean;
		intent: DeployIntent;
		/** `retryConsequences`' output, verbatim. */
		consequences: string[];
		/** The build being resent, for the header and the typed box. */
		tag: string | null;
		/** Runs the retry. The dialog stays open while a returned promise is pending; if it rejects, the reason prints inside the dialog (a toast would sit under the backdrop). */
		onConfirm: () => void | Promise<void>;
		/** The dialog was closed (Cancel, Esc) while the request was in flight and it then failed: there is no dialog left to print the reason in, so the host reports it (a toast). */
		onClosedFailure?: (message: string) => void;
	}

	let { open = $bindable(), intent, consequences, tag, onConfirm, onClosedFailure }: Props = $props();

	// See `a11y.svelte.ts`: the dialog traps focus natively but cannot return it.
	modalFocusReturn(() => open);

	const level = $derived(confirmLevel(intent));
	const label = $derived(deployActionLabel(intent));
	const title = $derived(retryTitle(intent, tag));

	let typed = $state('');
	let pending = $state(false);
	let failure = $state('');
	let confirmBtnEl = $state<HTMLButtonElement | null>(null);
	async function confirm() {
		pending = true;
		// The pressed button is about to be disabled; park focus on the dialog so it never drops to <body>.
		void tick().then(() => confirmBtnEl?.closest('dialog')?.focus());
		failure = '';
		try {
			await onConfirm();
			open = false;
		} catch (e) {
			const message = retryFailureText(e);
			if (open) {
				failure = message;
				pending = false;
				// The pressed button was disabled while the request ran, so focus fell to <body>: put it back inside the dialog.
				await tick();
				confirmBtnEl?.focus();
			} else onClosedFailure?.(message);
		} finally {
			pending = false;
		}
	}
	// Re-arm on every open. A dialog that remembers the sha you typed last time
	// is a typed confirm you only have to satisfy once.
	$effect(() => {
		if (open) {
			typed = '';
			failure = '';
		}
	});

	const blocked = $derived(pending || (level === 'typed' && typed.trim() !== (tag ?? '')));
</script>

<!-- role="dialog" aria-modal="true": flowbite's `Dialog` sets neither on the
     native `<dialog>` it renders, and a live accessibility check found this
     product's open modals computing to group/alert/status roles, never
     `dialog`. `aria-labelledby`/`aria-describedby` point at real `id`s below
     (`rcm-title`, `rcm-sub`). -->
<Modal
	bind:open
	title=""
	size="sm"
	dismissable={false}
	role="dialog"
	aria-modal="true"
	tabindex={-1}
	aria-busy={pending}
	class="rounded-lg bg-overlay"
	classes={{ body: 'p-0 space-y-0' }}
	aria-labelledby="rcm-title"
	aria-describedby="rcm-sub"
>
	<div class="border-b border-line px-5 py-4">
		<div class="flex items-start gap-3">
			<!-- a neutral disc: Retry resends a build this place already ran, which is not the dangerous act a solid danger disc says; the typed version is the care -->
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-subtle ring-1 ring-line" data-retry-icon>
				<RefreshOutline class="h-5 w-5 text-fg-muted" />
			</div>
			<div class="min-w-0 flex-1">
				<h2 id="rcm-title" class="t-heading text-fg">{title}?</h2>
				<p id="rcm-sub" class="t-meta text-fg-subtle">This starts a new deployment attempt.</p>
			</div>
			<!-- the close X sits in the header, ahead of Cancel and the confirm, so it is first in tab order, as in the Roll back dialog -->
			<button type="button" class="btn btn-ghost btn-sm btn-icon hit-44 -my-1 -mr-2 shrink-0" aria-label="Close" onclick={() => (open = false)}>
				<CloseOutline class="h-4 w-4" aria-hidden="true" />
			</button>
		</div>
	</div>

	<div class="space-y-4 px-5 py-4">
		<!-- THE CONSEQUENCES, ONE PER ROW. A list and not a paragraph because a
		     production retry carries four separate facts and the one that matters
		     most at 3am — that pressing this erases the failure detail — must not
		     be the tail of a run-on sentence. Neutral well, no tint: hue lives in
		     the header disc only (round 2). -->
		{#if consequences.length > 0}
			<ul class="space-y-2 rounded-md border border-line bg-subtle p-3">
				{#each consequences as line}
					<li class="flex gap-2">
						<span
							class="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-disabled"
							aria-hidden="true"
						></span>
						<span class="t-meta min-w-0 break-words text-fg-muted">{line}</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if level === 'typed' && tag}
			<div>
				<label for="rcm-confirm" class="mb-1 block t-meta text-fg-subtle">
					{typedPrompt(intent)}
					<span class="font-mono text-fg">{tag}</span> to confirm
				</label>
				<input
					id="rcm-confirm"
					type="text"
					bind:value={typed}
					autocomplete="off"
					class="input w-full"
				/>
			</div>
		{/if}
	</div>

	{#if failure}
		<div class="px-5 pb-4">
			<div role="alert" class={DIALOG_ERROR_CLASS} data-dialog-error>
				<ExclamationCircleSolid class="mt-0.5 h-4 w-4 shrink-0" />
				<p class="min-w-0 flex-1" data-retry-error>{failure}</p>
			</div>
		</div>
	{/if}
	<div class="flex justify-end gap-2 border-t border-line px-5 py-3">
		<button type="button" class="btn btn-secondary btn-sm" onclick={() => (open = false)}
			>Cancel</button
		>
		<button
			type="button"
			class="btn btn-primary btn-sm"
			bind:this={confirmBtnEl}
			disabled={blocked}
			onclick={confirm}
		>
			{#if pending}
				<StatusSpinner size="4" color="white" />
				<span class="truncate">Retrying…</span>
			{:else}
				<RefreshOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
				<span class="truncate">{label}</span>
			{/if}
		</button>
	</div>
</Modal>
