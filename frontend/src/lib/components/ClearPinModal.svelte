<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⛔ "RELEASE THE HOLD" DID NOT RELEASE THE HOLD. THIS COMPONENT IS THE
	 * CONTROL IT WAS ALWAYS PROMISING. (2026-08-31)
	 *
	 * A live UX critique followed the CTA end to end:
	 *
	 * > *"On `/apps` it is an `<a href="/apps/<name>">` styled as a button. On
	 * > `/apps/<name>` it opens **Change Version** — a version picker
	 * > containing no way to clear a pin. The real control is `Clear pin` on
	 * > rollout detail, two pages away. A CTA that lands on the wrong control
	 * > is worse than no CTA, because the operator now believes they tried."*
	 *
	 * The act existed; it was reachable from exactly one page. So it moves
	 * into a component and the button that names it now performs it.
	 *
	 * ── WHY THE COPY IS COPIED, NOT REWRITTEN ───────────────────────────────
	 *
	 * The same critique named rollout detail's clear-pin dialog **the best copy
	 * in the product** — *"states the consequence, the non-consequence, and
	 * names the rule in human terms."* `clearPinOutcome` is what does that: it
	 * reads the rollout's OTHER holds and says whether anything will actually
	 * move. Duplicating the markup on a second page would have been the way to
	 * lose it, so rollout detail uses this component too and there is one copy.
	 */
	import { Modal, Button, Toast } from 'flowbite-svelte';
	import { LockOpenOutline, ExclamationCircleSolid } from 'flowbite-svelte-icons';
	import type { Rollout } from '../../types';
	import {
		autoDeployState,
		clearPinOutcome,
		type AutoDeployState
	} from '$lib/view-models/auto-deploy';
	import { newestDeployableCandidate, promotionCandidates } from '$lib/view-models/promotion';
	import { rolloutEnvironmentName } from '$lib/view-models/deploy-risk';
	import { isFieldManagedByManager, isFieldManagedByOtherManager, formatTimeAgoCompact } from '$lib/utils';
	import { shortRevision } from '$lib/version-utils';
	import { announce } from '$lib/stores/announce.svelte';
	import { CLEAR_PIN_LABEL, clearPinDialogTitle } from './pin-copy';
	import { apiPath } from '$lib/api/urls';

	interface Props {
		open: boolean;
		rollout: Rollout | null;
		/** Multi-cluster: the cluster name when this rollout lives on a spoke. */
		cluster?: string;
		/**
		 * Rollout detail derives this WITH the full gate objects, so its
		 * sentence can print the gates' published pretty names. Everywhere else
		 * the same truth is derived from the rollout alone rather than silence.
		 */
		autoDeploy?: AutoDeployState | null;
		/**
		 * ⭐ WHICH ENVIRONMENT THIS ACTUALLY UNPINS, NAMED.
		 *
		 * From a live operator walk on `/apps/hello-world-app` — a page listing
		 * THREE environments, with the banner saying DEV is pinned — the dialog
		 * this opens asked *"Remove the version pin for hello-world-app?"* with
		 * no environment anywhere in it, while it unpins only the one rollout it
		 * was actually opened for. Optional and rarely needed: every call site
		 * hands over one rollout, whose own `metadata.labels.environment` (or
		 * the environment-theme annotations, or the namespace) already resolves
		 * it — see `rolloutEnvironmentName`. A caller only needs this when it
		 * knows a truer name than the rollout can derive on its own.
		 */
		environmentName?: string | null;
		onSuccess?: ((message: string) => void) | null;
		onError?: ((message: string) => void) | null;
		/**
		 * Raise the component's own toast. Rollout detail sets this false
		 * because it already owns one; every other caller gets feedback without
		 * having to build a second toast to get it.
		 */
		toast?: boolean;
	}

	let {
		open = $bindable(),
		rollout,
		cluster,
		autoDeploy = null,
		environmentName = null,
		onSuccess = null,
		onError = null,
		toast = true
	}: Props = $props();

	// `DEV`, `STAGING`, `PROD` — the product's own case for an environment
	// tier, matched to the `[DEV]` chips this rollout appears under elsewhere.
	const envLabel = $derived(rolloutEnvironmentName(rollout, environmentName).toUpperCase());
	// ⛔ THE COMMENT ABOVE PROMISED THIS AND THE CODE DID NOT DO IT.
	// (coordinator residue, 2026-09-03) `cluster ? … : ''` said it aloud
	// whenever the prop was merely present, so the prod rollout — whose
	// cluster is itself named "prod" — read "in PROD on the prod cluster",
	// the exact stutter this comment already said to avoid. Comparing
	// case-insensitively against `envLabel` is what actually disambiguates:
	// `cluster` and the environment word are never spelled in the same case.
	const clusterSuffix = $derived(
		cluster && cluster.toLowerCase() !== envLabel.toLowerCase() ? ` on the ${cluster} cluster` : ''
	);
	const clearPinTitle = $derived(
		rollout?.metadata?.name && envLabel
			? clearPinDialogTitle(rollout.metadata.name, envLabel)
			: CLEAR_PIN_LABEL
	);

	let showLocalToast = $state(false);
	let localToastMessage = $state('');
	let localToastType = $state<'success' | 'error'>('success');

	function notify(kind: 'success' | 'error', message: string) {
		// The live region is raised here rather than at each call site, so no
		// caller can wire the button up and lose the announcement.
		announce(message, kind === 'error' ? 'assertive' : 'polite');
		(kind === 'success' ? onSuccess : onError)?.(message);
		if (!toast) return;
		localToastType = kind;
		localToastMessage = message;
		showLocalToast = true;
		setTimeout(() => (showLocalToast = false), 3000);
	}

	const gateState = $derived(autoDeploy ?? autoDeployState(rollout));

	/**
	 * ⭐ ITEM 8 (2026-09-06 critique) — WHO PINNED THIS, AND WHEN, ONLY WHEN
	 * THE API ACTUALLY CARRIES IT. The dialog never said either — additive,
	 * so a fixture with neither fact (no matching history entry, no
	 * annotation) renders nothing new and every existing caller/test is
	 * unaffected.
	 *
	 * WHO: `rollout.kuberik.com/deploy-user` — set by the SAME `/pin` /
	 * `/change-version` handler that sets `spec.wantedVersion`
	 * (`pkg/kubernetes/client.go`'s `UpdateRolloutVersion`), so while the
	 * pin is in effect this annotation is, in practice, whoever last touched
	 * it. Never invented: absent on a service-account-driven pin.
	 *
	 * WHEN: the newest `status.history` entry whose `message` is the
	 * controller's own pin boilerplate (`history-marks.ts`'s closed set:
	 * `Pinned version` from `/change-version`, `Pinned to version …` from
	 * `/pin`). A pin applied to the version already running writes no new
	 * history entry at all — `whenIso` stays null there, and the line
	 * degrades to naming only who, per "whichever facts exist."
	 */
	const PIN_HISTORY_RE = [/^Pinned version$/, /^Pinned to version /];
	const pinnedByWho = $derived(
		rollout?.metadata?.annotations?.['rollout.kuberik.com/deploy-user'] || null
	);
	const pinnedAtIso = $derived(
		(rollout?.status?.history ?? []).find((h) => PIN_HISTORY_RE.some((re) => re.test(h.message ?? '')))
			?.timestamp ?? null
	);
	const pinnedByLine = $derived.by(() => {
		if (!pinnedByWho && !pinnedAtIso) return null;
		const when = pinnedAtIso ? `${formatTimeAgoCompact(pinnedAtIso)} ago` : null;
		if (pinnedByWho && when) return `Pinned by ${pinnedByWho} · ${when}`;
		if (pinnedByWho) return `Pinned by ${pinnedByWho}`;
		return `Pinned ${when}`;
	});

	/**
	 * ⭐ ITEM 8 (2026-09-06 critique) — THE CONCRETE MOVE, WHEN THE NEWEST
	 * ALLOWED BUILD IS KNOWN. "Automatic promotion resumes" named no build;
	 * an operator confirming the press could not tell whether the rollout
	 * was about to sit still or jump twenty releases. `otherReasons` mirrors
	 * `clearPinOutcome`'s own `rest.reasons` filter exactly (auto-deploy.ts
	 * is shared with rollout detail's identical dialog, so this reads its
	 * predicate rather than forking it) — only when nothing ELSE would hold
	 * the rollout back is a "moves to" claim honest; that branch is left to
	 * print its own "nothing will move yet" sentence unchanged.
	 */
	const otherReasons = $derived(gateState.reasons.filter((r) => r !== 'pin'));
	const concreteMove = $derived.by(() => {
		if (!rollout || otherReasons.length > 0) return null;
		const current = shortRevisionOrNull(rollout.status?.history?.[0]?.version?.revision);
		const target = shortRevisionOrNull(newestDeployableCandidate(rollout)?.revision);
		if (!current || !target || current === target) return null;
		const count = promotionCandidates(rollout).length;
		return `${envLabel} moves ${current} → ${target}${count > 1 ? ` (${count} newer builds allowed)` : ''}.`;
	});

	function shortRevisionOrNull(rev: string | null | undefined): string | null {
		return rev ? shortRevision(rev) : null;
	}

	/**
	 * The same guard rollout detail applies: if another controller owns
	 * `spec.wantedVersion`, clearing it here will be fought over. Said, not
	 * hidden — the operator can still press it.
	 */
	const isDashboardManaging = $derived.by(() => {
		if (!rollout) return false;
		if (rollout.spec?.wantedVersion === undefined) return true;
		const managed = rollout.metadata?.managedFields;
		if (managed) {
			if (isFieldManagedByManager(managed, 'rollout-dashboard', 'spec.wantedVersion')) return true;
			if (isFieldManagedByOtherManager(managed, 'rollout-dashboard', 'spec.wantedVersion'))
				return false;
		}
		return true;
	});

	let busy = $state(false);

	async function clearPin() {
		if (!rollout || busy) return;
		busy = true;
		try {
			const response = await fetch(
				apiPath(cluster, `/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/pin`),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ version: null, explanation: '' })
				}
			);
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				if (
					response.status === 500 &&
					typeof errorData.details === 'string' &&
					errorData.details.includes('dashboard is not managing the wantedVersion field')
				) {
					throw new Error(
						"Cannot clear pin: Dashboard is not managing this rollout's wantedVersion field. This field may be managed by another controller or external system."
					);
				}
				throw new Error('Failed to clear pin');
			}
			open = false;
			notify('success', 'Successfully cleared version pin');
		} catch (e) {
			open = false;
			notify('error', e instanceof Error ? e.message : 'Failed to clear pin');
		} finally {
			busy = false;
		}
	}
</script>

<!-- ⛔ NO `role`/`aria-modal`/LABELLED TITLE ANYWHERE IN THIS PRODUCT'S
     MODALS. (operator walk, 2026-09-03) flowbite's `Dialog` sets neither on
     the native `<dialog>` element and relies on implicit semantics that a
     live accessibility check did not observe — every open dialog's computed
     role came back `group`/`alert`/`status`, never `dialog`. `role="dialog"`
     and `aria-modal="true"` flow through `restProps` straight onto the
     `<dialog>`. `title` alone renders flowbite's own `<h3>`, which has no
     `id` for `aria-labelledby` to point at — `aria-label` gives the dialog
     an accessible name directly, without needing one. -->
<Modal bind:open title={clearPinTitle} role="dialog" aria-modal="true" aria-label={clearPinTitle}>
	<div class="space-y-4">
		<p class="text-sm text-gray-600 dark:text-gray-400">
			<!-- ⛔ THIS USED TO NAME NO ENVIRONMENT, ON A PAGE LISTING THREE OF
			     THEM. The dialog acts on exactly ONE rollout — the one it was
			     opened for — so it says which one before the press, the same way
			     the title above it does. -->
			This clears the pin currently held in <strong>{envLabel}</strong>{clusterSuffix}.
			<!-- ⭐ THE ROLLOUT RIDES ALONG NOW. (2026-09-03, UX-walk iteration 2,
			     finding 5) The dialog used to promise "moves to the newest
			     allowed version" with no version anywhere in the sentence — an
			     operator confirming the press could not tell whether that meant
			     one build away or twenty. `clearPinOutcome`'s optional second
			     argument names the actual target and how many builds are newer,
			     computed from the SAME `promotionCandidates`/
			     `newestDeployableCandidate` the upgrades card reads, so this
			     sentence cannot name a different build than that card does.
			     ⭐ ITEM 8 (2026-09-06 critique) — AND WHEN THE MOVE IS KNOWN,
			     THE MOVE IS THE SENTENCE. `concreteMove` names the two
			     revisions directly (`DEV moves 6f9524e → 064b655`) in place of
			     the generic "Automatic promotion resumes" whenever nothing
			     else would hold the rollout back; `clearPinOutcome`'s own
			     sentence is the fallback everywhere it is still the more
			     honest claim (nothing moves, or the target is unknowable). -->
			{#if concreteMove}
				{concreteMove}
			{:else}
				{clearPinOutcome(gateState, rollout)}
			{/if}
		</p>
		{#if pinnedByLine}
			<!-- ⭐ ITEM 8 (2026-09-06 critique) — WHO PINNED THIS, AND WHEN. See
			     `pinnedByLine`'s own comment: renders only when the API
			     actually carries at least one of the two facts. -->
			<p class="text-xs text-gray-500 dark:text-gray-400">{pinnedByLine}</p>
		{/if}
		{#if !isDashboardManaging}
			<p class="text-xs text-amber-600 dark:text-amber-400">
				The dashboard is not managing the wantedVersion field. Clearing may conflict with other
				controllers.
			</p>
		{/if}
		<div class="flex justify-end gap-2 pt-2">
			<Button color="light" onclick={() => (open = false)}>Cancel</Button>
			<Button color="blue" disabled={busy} onclick={clearPin}>
				<LockOpenOutline class="mr-1.5 h-4 w-4" />
				{CLEAR_PIN_LABEL}
			</Button>
		</div>
	</div>
</Modal>

{#if showLocalToast}
	<Toast class="fixed top-24 right-4 z-50 rounded-lg" bind:toastStatus={showLocalToast}>
		{#snippet icon()}
			<div
				class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {localToastType ===
				'success'
					? 'bg-gray-100 text-green-700 dark:bg-gray-700 dark:text-green-400'
					: 'bg-red-100 text-red-500 dark:bg-red-800 dark:text-red-200'}"
			>
				<ExclamationCircleSolid class="h-5 w-5" />
			</div>
		{/snippet}
		{localToastMessage}
	</Toast>
{/if}
