<svelte:options runes={true} />

<script lang="ts">
	import SkeletonBar from '$lib/components/skeleton/SkeletonBar.svelte';
	/**
	 * ROLE: the one-sentence consent step that opens before a deploy or a
	 * rollback which will run in RECOVERY MODE (the controller waits for
	 * health checks to recover instead of failing the deployment on them).
	 *
	 * ⭐ ROUND 6 (squad-rollout, Lane D, 2026-10-10 — AD round 4, item 1: "a
	 * stranger to the family"). Rebuilt on `ChangeVersionModal`'s confirm
	 * shell, byte-for-byte the same geometry, because the operator presses
	 * Continue and this dialog is REPLACED by that confirm at the same place:
	 * any difference in width, inset, header or footer reads as a jump.
	 *   - 640 wide, top-anchored at 12vh (the confirm's own position);
	 *     below `sm` the confirm's own FULL-HEIGHT sheet (coordinator, round
	 *     7, reversing round 6's bottom sheet: one dialog per step changing
	 *     in place, never a sheet that grows into a full screen on Continue);
	 *   - header: the rollout crumb (`t-meta`) above the title (`t-heading`,
	 *     wraps, never truncates), a 32px ghost close on the title's line;
	 *   - body: one 16px inset, ONE sentence (`t-body text-fg-muted`) that
	 *     says what happens next. No disc, no inset rules, no well: the
	 *     sentence is the whole content, the title already names the object;
	 *   - footer: `Esc` hint left; Cancel + the primary right (`btn-sm`);
	 *     below `sm` a 50/50 split of 44px buttons above the safe area;
	 *   - the page behind is locked (the same counter `ChangeVersionModal`
	 *     and the palette share), and the first focus lands on the dialog
	 *     body, never on Cancel (a ring on Cancel read as "Cancel is the
	 *     default", AD round 4).
	 * Recovery mode is a CAUTION, not a hold and not a stuck state: no hue
	 * anywhere (amber is stuck only, orange is held only — §2.5).
	 */
	import { Modal } from 'flowbite-svelte';
	import { CloseOutline } from 'flowbite-svelte-icons';
	import { modalFocusReturn } from '$lib/a11y.svelte';
	import type { Rollout } from '../../types';
	import { deployIntent } from '$lib/view-models/deploy-risk';

	type Reason = import('$lib/view-models/change-version-entry').RecoveryReason;

	interface Props {
		open: boolean;
		reason: Reason;
		/** Health checks the verdict depends on are still loading: skeleton in place of the sentence, Continue disabled. */
		loading?: boolean;
		/** The build about to deploy, as displayed (`3f1ed09`). */
		versionDisplay?: string | null;
		/** The build that failed (`history[0]`), as displayed. */
		previousVersionDisplay?: string | null;
		/**
		 * The rollout and the tag about to deploy, so the title can name the
		 * act exactly as the confirm that follows does ("Roll back staging to
		 * 3f1ed09" / "Deploy 3f1ed09 to staging"), via the SAME `deployIntent`.
		 * Without a tag (Change version opened before a build is picked) the
		 * title says only that the next deploy runs in recovery mode.
		 */
		rollout?: Rollout | null;
		selectedTag?: string | null;
		environmentName?: string | null;
		onContinue: () => void;
		onCancel?: () => void;
	}

	let {
		open = $bindable(),
		reason,
		loading = false,
		versionDisplay = null,
		previousVersionDisplay = null,
		rollout = null,
		selectedTag = null,
		environmentName = null,
		onContinue,
		onCancel = () => {}
	}: Props = $props();

	// Native `<dialog>` handles the trap and the inert background; it cannot
	// restore focus here because the element is destroyed, not closed.
	modalFocusReturn(() => open);

	// The page lock, shared with ChangeVersionModal / the palette (same counter).
	$effect(() => {
		if (typeof document === 'undefined' || !open) return;
		const w = window as unknown as { __scrollLockCount?: number };
		w.__scrollLockCount = (w.__scrollLockCount ?? 0) + 1;
		document.documentElement.classList.add('scroll-locked');
		// Body lock below `sm`, counted (shared with ChangeVersionModal, which
		// opens as this closes: a restored value would unlock its sheet).
		const b = window as unknown as { __bodyLockCount?: number };
		const phone = window.matchMedia('(max-width: 639px)').matches;
		if (phone) {
			b.__bodyLockCount = (b.__bodyLockCount ?? 0) + 1;
			document.body.style.overflow = 'hidden';
		}
		return () => {
			if (phone) {
				b.__bodyLockCount = Math.max(0, (b.__bodyLockCount ?? 1) - 1);
				if (b.__bodyLockCount === 0) document.body.style.overflow = '';
			}
			w.__scrollLockCount = Math.max(0, (w.__scrollLockCount ?? 1) - 1);
			if (w.__scrollLockCount === 0) document.documentElement.classList.remove('scroll-locked');
		};
	});

	const intent = $derived(selectedTag ? deployIntent(rollout, selectedTag, environmentName) : null);
	const where = $derived(intent?.environment || environmentName || 'this environment');
	const isRollback = $derived(intent?.direction === 'rollback');
	const act = $derived(isRollback ? 'rollback' : 'deploy');

	const title = $derived.by(() => {
		if (loading) {
			const to = versionDisplay ? ' to ' + versionDisplay : '';
			return isRollback ? 'Roll back ' + where + to : 'Deploy to ' + where;
		}
		if (reason === 'health-checks-unavailable') {
			return !versionDisplay || !intent
				? `Deploy to ${where}`
				: isRollback
					? `Roll back ${where} to ${versionDisplay}`
					: `Deploy ${versionDisplay} to ${where}`;
		}
		if (!versionDisplay || !intent) return `Deploy to ${where} in recovery mode`;
		return isRollback
			? `Roll back ${where} to ${versionDisplay}`
			: `Deploy ${versionDisplay} to ${where}`;
	});

	/** ONE sentence: why recovery mode applies, and what it does next. */
	const summary = $derived.by(() => {
		if (reason === 'health-checks-unavailable') {
			return `Health checks couldn't be loaded, so the dashboard can't tell whether this ${act} runs in recovery mode.`;
		}
		const cause =
			reason === 'previous-failed'
				? previousVersionDisplay
					? `${previousVersionDisplay} failed`
					: 'The last deploy failed'
				: 'Health checks are unhealthy';
		return `${cause}, so this ${act} runs in recovery mode: it waits for health checks to recover instead of failing on them.`;
	});

	const crumb = $derived(rollout?.metadata?.name ?? null);

	function cancel() {
		open = false;
		onCancel();
	}
</script>

<Modal
	bind:open
	title=""
	size="none"
	autoclose={false}
	dismissable={false}
	role="dialog"
	aria-modal="true"
	aria-labelledby="rmw-title"
	aria-describedby="rmw-summary"
	classes={{ body: 'p-0 space-y-0 max-sm:h-full' }}
	class="[&>div]:p-0 w-full max-w-[640px] rounded-lg sm:mt-[12vh] sm:mb-auto max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
>
	<div class="flex flex-col max-sm:h-full">
		<div class="min-h-0 flex-1 max-sm:overflow-y-auto">
			<header class="border-b border-line px-4 py-3">
				{#if crumb}
					<p class="t-meta truncate text-fg-subtle">{crumb}</p>
				{/if}
				<div class="flex items-start gap-1">
					<h2 id="rmw-title" class="t-heading min-w-0 flex-1 text-fg">{title}</h2>
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-icon hit-44 -my-1 -mr-2 shrink-0"
						aria-label="Close"
						onclick={cancel}
					>
						<CloseOutline class="h-4 w-4" aria-hidden="true" />
					</button>
				</div>
			</header>
			<!-- `data-autofocus` + `tabindex=-1`: flowbite's Dialog focuses
			     `[data-autofocus]` first, so the open lands here (no ring on
			     Cancel) and Tab still reaches Cancel → Continue in order. -->
			<div class="px-4 py-4 outline-none" data-autofocus tabindex="-1">
				{#if loading}
					<div id="rmw-summary" class="space-y-2" aria-busy="true">
						<SkeletonBar width="w-full" height="h-[15px]" />
						<SkeletonBar width="w-2/3" height="h-[15px]" />
					</div>
				{:else}
					<p id="rmw-summary" class="t-body text-fg-muted">{summary}</p>
				{/if}
			</div>
		</div>

		<div
			class="flex shrink-0 items-center justify-between gap-2 border-t border-line px-4 py-3 max-sm:pb-[calc(12px+env(safe-area-inset-bottom))]"
		>
			<div class="t-meta hidden items-center gap-2 text-fg-subtle sm:flex">
				<span class="kbd">Esc</span>
				<span>to cancel</span>
			</div>
			<div class="flex items-center gap-2 max-sm:w-full">
				<button
					type="button"
					class="btn btn-secondary btn-sm max-sm:min-h-11 max-sm:flex-1 max-sm:basis-0"
					onclick={cancel}
				>
					Cancel
				</button>
				<button
					type="button"
					class="btn btn-primary btn-sm max-sm:min-h-11 max-sm:flex-1 max-sm:basis-0"
					disabled={loading}
					onclick={() => {
						open = false;
						onContinue();
					}}
				>
					Continue
				</button>
			</div>
		</div>
	</div>
</Modal>
