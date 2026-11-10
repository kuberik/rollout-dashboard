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
	 */
	import { Modal } from 'flowbite-svelte';
	import { ExclamationCircleSolid, RefreshOutline } from 'flowbite-svelte-icons';
	import { modalFocusReturn } from '$lib/a11y.svelte';
	import {
		confirmLevel,
		deployActionLabel,
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
		onConfirm: () => void;
	}

	let { open = $bindable(), intent, consequences, tag, onConfirm }: Props = $props();

	// See `a11y.svelte.ts`: the dialog traps focus natively but cannot return it.
	modalFocusReturn(() => open);

	const level = $derived(confirmLevel(intent));
	const label = $derived(deployActionLabel(intent));

	let typed = $state('');
	// Re-arm on every open. A dialog that remembers the sha you typed last time
	// is a typed confirm you only have to satisfy once.
	$effect(() => {
		if (open) typed = '';
	});

	const blocked = $derived(level === 'typed' && typed.trim() !== (tag ?? ''));
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
	role="dialog"
	aria-modal="true"
	class="rounded-lg bg-overlay"
	classes={{ body: 'p-0 space-y-0' }}
	aria-labelledby="rcm-title"
	aria-describedby="rcm-sub"
>
	<div class="border-b border-line px-5 py-4">
		<div class="flex items-start gap-3">
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 {level ===
				'typed'
					? 'bg-danger-tint ring-danger-line'
					: 'bg-held-tint ring-held-line'}"
			>
				<ExclamationCircleSolid class="h-5 w-5 {level === 'typed' ? 'text-danger' : 'text-held'}" />
			</div>
			<div class="min-w-0">
				<h2 id="rcm-title" class="t-heading text-fg">{label}?</h2>
				<p id="rcm-sub" class="t-meta text-fg-subtle">This starts a new deployment attempt.</p>
			</div>
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
					<span class="text-danger">{tag}</span> to confirm
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

	<div class="flex justify-end gap-2 border-t border-line px-5 py-3">
		<button type="button" class="btn btn-secondary btn-sm" onclick={() => (open = false)}
			>Cancel</button
		>
		<button
			type="button"
			class="btn btn-sm {level === 'typed' ? 'btn-danger' : 'btn-primary'}"
			disabled={blocked}
			onclick={() => {
				open = false;
				onConfirm();
			}}
		>
			<RefreshOutline class="h-4 w-4 shrink-0" />
			<span class="truncate">{label}</span>
		</button>
	</div>
</Modal>
