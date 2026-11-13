<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ SKIP ONE RULE FOR ONE BUILD, ON ONE OR MANY ROLLOUTS. (bypass-only, 2026-11-13; spec `.work/bypass-only/design-spec.md` §3,
	 * with the coordinator's ceremony ruling.)
	 *
	 * Role: confirms skipping ONE rule for ONE held build, on the rollout the trigger was pressed on and, opt-in, on every other rollout
	 * that same rule holds. Why nothing existing fits: ChangeVersionModal picks a VERSION for one rollout and skips every rule;
	 * RetryConfirmModal confirms one rollout with no selection. This is a rule-first act across rollouts. It reuses RetryConfirmModal's
	 * shell, disc and typed block verbatim. The list rows borrow the Held builds card's row (env chip, mono build on a right track), and
	 * the list header borrows Card's count rollup.
	 *
	 * ⛔ NO STRINGS ARE INVENTED HERE for the ceremony: `skipConfirm` (deploy-risk.ts) decides whether production needs typing, what is
	 * typed (the one shared build, or the rule's name when the production builds differ) and the one line that says why.
	 *
	 * ⛔ THE SENTENCE IS SAID ONCE (`skipSentence`) and follows the selection. The size (sm without a list, md with one) is decided when the
	 * dialog opens and never changes while it is open.
	 *
	 * Submit: one POST per selected rollout through its own cluster path, at most 4 at a time, each row settling on its own. Never `gates`,
	 * never an empty body. Success is read back from the server (the queries are invalidated), not drawn optimistically.
	 */
	import { Modal } from 'flowbite-svelte';
	import { ExclamationCircleSolid, ForwardStepOutline } from 'flowbite-svelte-icons';
	import { createQueries, useQueryClient } from '@tanstack/svelte-query';
	import Chip from './Chip.svelte';
	import ClusterMark from './ClusterMark.svelte';
	import StatusSpinner from './StatusSpinner.svelte';
	import Toast from './Toast.svelte';
	import { modalFocusReturn } from '$lib/a11y.svelte';
	import { announce } from '$lib/stores/announce.svelte';
	import { modEnterHint } from '$lib/shortcut-hint';
	import { shortEnvLabel, type EnvironmentTheme } from '$lib/environment-theme';
	import { rolloutPermissionsQueryOptions } from '$lib/api/rollouts';
	import { skipRuleOnce, skipErrorCopy } from '$lib/api/bypass';
	import { skipConfirm } from '$lib/view-models/deploy-risk';
	import { skipRowKey, skipSentence, skippedToast, type SkipRow, type SkipTarget } from '$lib/view-models/skip-rule';

	type Status = 'idle' | 'pending' | 'ok' | 'failed';
	type Failure = { before: string; build?: boolean; after: string };

	interface Props {
		open: boolean;
		target: SkipTarget;
		/** The rollout the trigger was pressed on. */
		here: { cluster: string; namespace: string; name: string; env: string };
		/** Every rollout this rule holds (`skipRows`), this one first. A list of one draws no list. */
		rows: SkipRow[];
		themeOf?: (env: string) => EnvironmentTheme | null;
		/** Called after every attempt settles, so the page can refetch. */
		onSettled?: () => void;
	}

	let { open = $bindable(), target, here, rows, themeOf = () => null, onSettled }: Props = $props();

	modalFocusReturn(() => open);
	const queryClient = useQueryClient();

	const hereKey = $derived(skipRowKey(here.cluster, here.namespace, here.name));
	// this rollout is always a row, even when the fleet list has not caught up with it
	const allRows = $derived<SkipRow[]>(
		rows.some((r) => r.key === hereKey)
			? rows
			: [
					{
						key: hereKey,
						cluster: here.cluster,
						namespace: here.namespace,
						name: here.name,
						env: here.env,
						tag: target.tag,
						build: target.build,
						gateNames: target.gateNames
					},
					...rows
				]
	);

	let listed = $state(false);
	let selected = $state<Set<string>>(new Set());
	let status = $state<Record<string, Status>>({});
	let failures = $state<Record<string, Failure>>({});
	let typed = $state('');
	let showAll = $state(false);
	let submitting = $state(false);
	let attempted = $state(0);
	let platform = $state<string | null>(null);
	$effect(() => {
		platform = navigator.platform;
	});

	// Re-arm on every open, and decide the size once.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			listed = allRows.length > 1;
			selected = new Set([hereKey]);
			status = {};
			failures = {};
			typed = '';
			showAll = false;
			submitting = false;
			attempted = 0;
		}
		wasOpen = open;
	});

	// Per-row permission: unknown = enabled (the server's 403 is the backstop).
	const permQueries = createQueries(() => ({
		queries: allRows.map((r) => ({
			...rolloutPermissionsQueryOptions({ namespace: r.namespace, name: r.name, cluster: r.cluster }),
			enabled: open && listed && r.key !== hereKey
		}))
	}));
	const cannot = $derived(
		new Set(
			allRows.filter((r, i) => {
				const p = permQueries[i]?.data?.permissions;
				return r.key !== hereKey && !!p && !p.update && !p.patch;
			}).map((r) => r.key)
		)
	);

	const multiCluster = $derived(new Set(allRows.map((r) => r.cluster)).size > 1);
	const visibleRows = $derived(showAll || allRows.length <= 9 ? allRows : allRows.slice(0, 8));
	const hidden = $derived(allRows.length - visibleRows.length);

	const locked = (k: string) => submitting || status[k] === 'ok' || (attempted > 0 && status[k] !== 'failed');
	const selectable = (k: string) => !cannot.has(k) && status[k] !== 'ok';
	const selectedRows = $derived(allRows.filter((r) => selected.has(r.key)));
	const toSend = $derived(selectedRows.filter((r) => status[r.key] !== 'ok'));

	const sentence = $derived(
		skipSentence(
			target.ruleLabel,
			selectedRows.map((r) => ({ name: r.name, env: r.env, build: r.build }))
		)
	);
	const confirm = $derived(
		skipConfirm(
			selectedRows.map((r) => ({ env: r.env, build: r.build, name: r.name })),
			target.rule
		)
	);
	const typedLevel = $derived(confirm.level === 'typed');
	// the typed box appears and disappears as the selection crosses production; its text resets when it goes
	$effect(() => {
		if (!typedLevel) typed = '';
	});

	const expected = $derived(confirm.level === 'typed' ? confirm.expected : '');
	const typedOk = $derived(confirm.level !== 'typed' || typed.trim() === expected);
	const canSubmit = $derived(toSend.length > 0 && typedOk && !submitting);

	const okCount = $derived(Object.values(status).filter((s) => s === 'ok').length);
	const failedCount = $derived(Object.values(status).filter((s) => s === 'failed').length);
	const partial = $derived(!submitting && failedCount > 0);

	const label = $derived(`Skip for ${toSend.length === 1 ? '1 rollout' : `${Math.max(toSend.length, 1)} rollouts`}`);

	function toggle(k: string) {
		if (locked(k) || !selectable(k)) return;
		const next = new Set(selected);
		next.has(k) ? next.delete(k) : next.add(k);
		selected = next;
	}
	const pickable = $derived(allRows.filter((r) => selectable(r.key)).map((r) => r.key));
	const allPicked = $derived(pickable.length > 0 && pickable.every((k) => selected.has(k)));
	function toggleAll() {
		if (submitting) return;
		selected = allPicked ? new Set() : new Set(pickable);
	}

	let toastOpen = $state(false);
	let toastMessage = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	async function submit() {
		if (!canSubmit) return;
		submitting = true;
		const batch = [...toSend];
		if (attempted === 0) attempted = batch.length;
		for (const r of batch) {
			status[r.key] = 'pending';
			delete failures[r.key];
		}
		let i = 0;
		const worker = async () => {
			while (i < batch.length) {
				const r = batch[i++];
				try {
					await skipRuleOnce({ cluster: r.cluster, namespace: r.namespace, name: r.name, version: r.tag, rule: target.rule });
					status[r.key] = 'ok';
				} catch (e) {
					status[r.key] = 'failed';
					failures[r.key] = skipErrorCopy(e, { ruleLabel: target.ruleLabel, cluster: r.cluster });
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(4, batch.length) }, worker));
		submitting = false;
		await queryClient.invalidateQueries({ queryKey: ['rollout'] });
		await queryClient.invalidateQueries({ queryKey: ['rollouts'] });
		onSettled?.();
		if (batch.every((r) => status[r.key] === 'ok')) {
			const done = allRows.filter((r) => status[r.key] === 'ok');
			const message = skippedToast(target.ruleLabel, done);
			open = false;
			toastMessage = message;
			toastOpen = true;
			announce(message);
			clearTimeout(toastTimer);
			toastTimer = setTimeout(() => (toastOpen = false), 3000);
		} else {
			// failed rows stay checked; every other row is unchecked and locked
			selected = new Set(allRows.filter((r) => status[r.key] === 'failed').map((r) => r.key));
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
			e.preventDefault();
			submit();
		}
	}
</script>

<!-- role="dialog" aria-modal="true": the same note as RetryConfirmModal (flowbite's native dialog sets neither). -->
<Modal
	bind:open
	title=""
	size={listed ? 'md' : 'sm'}
	role="dialog"
	aria-modal="true"
	class="rounded-lg bg-overlay"
	classes={{ body: 'p-0 space-y-0' }}
	aria-labelledby="srm-title"
	aria-describedby="srm-sub"
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div {onkeydown}>
		<div class="border-b border-line px-5 py-4">
			<div class="flex items-start gap-3">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 {typedLevel
						? 'bg-danger-tint ring-danger-line'
						: 'bg-held-tint ring-held-line'}"
				>
					{#if typedLevel}
						<ExclamationCircleSolid class="h-5 w-5 text-danger" />
					{:else}
						<ForwardStepOutline class="h-5 w-5 text-held" />
					{/if}
				</div>
				<div class="min-w-0">
					<h2 id="srm-title" class="t-heading text-fg">Skip {target.ruleLabel} once</h2>
					<p id="srm-sub" class="t-meta text-fg-subtle">
						Every other rule still applies, and {target.ruleLabel} keeps holding every other build.
					</p>
				</div>
			</div>
		</div>

		<div class="space-y-4 px-5 py-4">
			<p class="t-body text-fg" data-skip-sentence>
				{#each sentence as p}{#if p.code}<span class="t-code">{p.text}</span>{:else}{p.text}{/if}{/each}
			</p>

			{#if !listed && failedCount > 0}
				{@const f = failures[hereKey]}
				{#if f}
					<p class="flex gap-2" data-skip-error>
						<ExclamationCircleSolid class="mt-0.5 h-4 w-4 shrink-0 text-danger" />
						<span class="t-meta min-w-0 text-fg-muted"
							>{f.before}{#if f.build}<span class="t-code-sm">{target.build}</span>{/if}{f.after}</span
						>
					</p>
				{/if}
			{/if}

			{#if listed}
				<div>
					<div class="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
						<span class="t-label text-fg-subtle min-w-0">Held by {target.ruleLabel}</span>
						<span class="ml-auto flex shrink-0 items-center gap-2">
							<span class="t-meta text-fg-subtle tabular-nums" data-skip-count>{selectedRows.length} of {allRows.length} selected</span>
							{#if attempted === 0}
								<button type="button" class="btn btn-xs btn-ghost shrink-0" disabled={submitting} onclick={toggleAll}>{allPicked ? 'Select none' : 'Select all'}</button>
							{/if}
						</span>
					</div>
					<ul class="divide-y divide-line-subtle rounded-md border border-line bg-surface" data-skip-list>
						{#each visibleRows as r (r.key)}
							{@const theme = themeOf(r.env)}
							{@const disabled = !selectable(r.key) || locked(r.key)}
							<li data-skip-row={r.key}>
								<label
									class="flex min-h-11 items-center gap-3 px-3 {cannot.has(r.key) ? 'opacity-60' : ''} {disabled ? '' : 'cursor-pointer'}"
									title={cannot.has(r.key) ? "You can't change this rollout" : undefined}
								>
									<input
										type="checkbox"
										class="h-4 w-4 shrink-0 rounded-[4px] border-line-strong accent-blue-700"
										checked={selected.has(r.key)}
										{disabled}
										onchange={() => toggle(r.key)}
									/>
									<!-- one line from sm: name, env chip, cluster, build on a fixed right track. On a phone the name keeps line one to itself
									     (it truncates last, never to nothing) and the chip, cluster and build take line two. -->
									<span class="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5 sm:flex-row sm:items-center sm:gap-2 sm:py-0">
										<span class="flex min-w-0 flex-1 items-center gap-2">
											<span class="t-ui min-w-0 truncate text-fg">{r.name}</span>
											{#if r.key === hereKey}<span class="t-meta shrink-0 text-fg-subtle">this rollout</span>{/if}
										</span>
										<span class="flex min-w-0 items-center gap-2">
											<span class="inline-flex shrink-0 sm:w-[76px]"><Chip role="env" {theme} label={shortEnvLabel(theme) || r.env} title={r.env} wide class="shrink-0" /></span>
											{#if multiCluster}<span class="inline-flex min-w-0 sm:w-28"><ClusterMark name={r.cluster} class="min-w-0 truncate" /></span>{/if}
											<span class="t-code-sm ml-auto shrink-0 truncate text-right tabular-nums text-fg-muted sm:w-24" title={r.tag}>{r.build}</span>
										</span>
									</span>
									<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center" data-skip-result={status[r.key] ?? 'idle'}>
										{#if status[r.key] === 'pending'}
											<StatusSpinner size="4" />
										{:else if status[r.key] === 'ok'}
											<span class="bg-success-solid h-1.5 w-1.5 rounded-full"><span class="sr-only">Skipped</span></span>
										{:else if status[r.key] === 'failed'}
											<ExclamationCircleSolid class="h-4 w-4 text-danger" /><span class="sr-only">Failed</span>
										{/if}
									</span>
								</label>
								{#if status[r.key] === 'failed' && failures[r.key]}
									{@const f = failures[r.key]}
									<p class="t-meta pb-2 pl-10 pr-3 text-fg-muted" data-skip-error>
										{f.before}{#if f.build}<span class="t-code-sm">{r.build}</span>{/if}{f.after}
									</p>
								{/if}
							</li>
						{/each}
					</ul>
					{#if hidden > 0}
						<button type="button" class="btn btn-sm btn-secondary mt-2" onclick={() => (showAll = true)}>Show {hidden} more</button>
					{/if}
				</div>
			{/if}

			{#if confirm.level === 'typed'}
				<div data-skip-typed>
					{#if confirm.by === 'rule'}
						<ul class="mb-3 divide-y divide-line-subtle rounded-md border border-line bg-subtle" data-skip-prod>
							{#each confirm.production as p}
								<li class="flex items-center gap-3 px-3 py-2">
									<span class="t-ui min-w-0 flex-1 truncate text-fg">{p.name}</span>
									<span class="t-meta shrink-0 text-fg-subtle">{p.env}</span>
									<span class="t-code-sm shrink-0 tabular-nums text-fg-muted">{p.build}</span>
								</li>
							{/each}
						</ul>
					{/if}
					{#if confirm.why}<p class="t-meta mb-1 text-fg-muted" data-skip-why>{confirm.why}</p>{/if}
					<label for="srm-confirm" class="mb-1 block t-meta text-fg-subtle">
						{confirm.prompt}
						<span class="t-code-sm text-danger">{confirm.expected}</span> to confirm
					</label>
					<input
						id="srm-confirm"
						type="text"
						bind:value={typed}
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						class="input w-full"
					/>
				</div>
			{/if}
		</div>

		{#if partial}
			<p class="t-meta px-5 pb-3" data-skip-summary>
				{#if okCount === 0}
					<span class="text-fg-muted">None skipped.</span>
				{:else}
					<span class="text-fg-muted">{okCount} of {attempted} skipped.</span>
				{/if}
				<span class="text-danger">{failedCount} failed.</span>
			</p>
		{/if}

		<div class="flex justify-end gap-2 border-t border-line px-5 py-3">
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => (open = false)}>{partial ? 'Close' : 'Cancel'}</button>
			<button type="button" class="btn btn-sm {typedLevel ? 'btn-danger' : 'btn-primary'}" disabled={!canSubmit} onclick={submit}>
				{#if submitting}
					<StatusSpinner size="4" color="white" />
					<span class="truncate">Skipping…</span>
				{:else}
					<ForwardStepOutline class="h-4 w-4 shrink-0" />
					<span class="truncate">{label}</span>
					{#if canSubmit}<span class="kbd hidden sm:inline">{modEnterHint(platform)}</span>{/if}
				{/if}
			</button>
		</div>
	</div>
</Modal>

<Toast bind:open={toastOpen} tone="success" message={toastMessage} />
