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
	 * COMPOSITION is `RetryTestsModal`'s — the dialog this product already uses
	 * for the other half of the retry path — so the two do not read as
	 * different products: a 48px circular glyph, a headline, the consequences as
	 * a list, then the controls.
	 */
	import { Modal, Button } from 'flowbite-svelte';
	import { ExclamationCircleSolid, PlaySolid } from 'flowbite-svelte-icons';
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
     `dialog`. `aria-labelledby`/`aria-describedby` already point at real
     `id`s below (`rcm-title`, `rcm-sub`) — this modal was already correctly
     labelled, just not correctly ROLED. -->
<Modal
	bind:open
	title=""
	size="sm"
	role="dialog"
	aria-modal="true"
	class="[&>div]:p-0"
	aria-labelledby="rcm-title"
	aria-describedby="rcm-sub"
>
	<div class="p-6">
		<div class="mb-5 flex flex-col items-center text-center">
			<div
				class="mb-3 flex h-12 w-12 items-center justify-center rounded-full {level === 'typed'
					? 'bg-red-100 dark:bg-red-900/30'
					: 'bg-yellow-100 dark:bg-yellow-900/30'}"
			>
				<ExclamationCircleSolid
					class="h-6 w-6 {level === 'typed'
						? 'text-red-600 dark:text-red-400'
						: 'text-yellow-600 dark:text-yellow-400'}"
				/>
			</div>
			<h2 id="rcm-title" class="text-lg font-semibold text-gray-900 dark:text-white">
				{label}?
			</h2>
			<p id="rcm-sub" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
				This starts a new deployment attempt.
			</p>
		</div>

		<!-- THE CONSEQUENCES, ONE PER ROW. A list and not a paragraph because a
		     production retry carries four separate facts and the one that matters
		     most at 3am — that pressing this erases the failure detail — must not
		     be the tail of a run-on sentence. -->
		{#if consequences.length > 0}
			<ul
				class="mb-5 space-y-2 rounded-lg p-3 text-sm {level === 'typed'
					? 'bg-red-50 text-red-900 dark:bg-red-950/50 dark:text-red-200'
					: 'bg-yellow-50 text-yellow-900 dark:bg-yellow-950/50 dark:text-yellow-100'}"
			>
				{#each consequences as line}
					<li class="flex gap-2">
						<span
							class="mt-2 h-1 w-1 shrink-0 rounded-full bg-current opacity-60"
							aria-hidden="true"
						></span>
						<span class="min-w-0 break-words">{line}</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if level === 'typed' && tag}
			<div class="mb-4">
				<label for="rcm-confirm" class="mb-1 block text-xs text-gray-500 dark:text-gray-400">
					{typedPrompt(intent)}
					<span class="font-semibold text-red-600 dark:text-red-400">{tag}</span> to confirm
				</label>
				<input
					id="rcm-confirm"
					type="text"
					bind:value={typed}
					autocomplete="off"
					class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
				/>
			</div>
		{/if}

		<div class="flex gap-2">
			<Button color="light" class="flex-1" onclick={() => (open = false)}>Cancel</Button>
			<Button
				color={level === 'typed' ? 'red' : 'yellow'}
				class="flex-1"
				disabled={blocked}
				onclick={() => {
					open = false;
					onConfirm();
				}}
			>
				<PlaySolid class="mr-2 h-4 w-4 shrink-0" />
				<span class="truncate">{label}</span>
			</Button>
		</div>
	</div>
</Modal>
