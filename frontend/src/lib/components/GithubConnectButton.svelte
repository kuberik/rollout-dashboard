<svelte:options runes={true} />

<script lang="ts">
	import { GithubSolid } from 'flowbite-svelte-icons';
	import { Dropdown, DropdownItem, Popover } from 'flowbite-svelte';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import {
		fetchGithubStatus,
		githubStatusQueryKey,
		connectGithub,
		disconnectGithub,
		githubAbsenceSentence
	} from '$lib/api/github';

	const queryClient = useQueryClient();

	const statusQuery = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 60_000,
		refetchInterval: false as const
	}));

	const status = $derived(statusQuery.data);
	const menuId = 'github-account-menu';

	/**
	 * The shape this control will take once `/api/auth/github/status` answers:
	 * the signed-in avatar, the "Connect GitHub" button, or the dashed
	 * "Not configured" button. Widths differ threefold, so the slot must be
	 * reserved at the width of the ONE shape that will render, not the widest.
	 */
	type Shape = 'account' | 'connect' | 'unconfigured';
	const SHAPE_KEY = 'kuberik.github-shape';

	// A browser that has never been here cannot be signed in yet, so the
	// first-ever visit reserves the "Connect GitHub" shape: the not-configured
	// button is within 16 px of it, and the signed-in avatar only ever follows
	// a visit that already remembered its shape.
	function readHint(): Shape {
		if (typeof localStorage === 'undefined') return 'connect';
		const v = localStorage.getItem(SHAPE_KEY);
		return v === 'account' || v === 'connect' || v === 'unconfigured' ? v : 'connect';
	}

	const shape = $derived.by((): Shape | null => {
		if (!status) return null;
		// ⭐ ITEM 4 (AD palette round 8): `configured === null` means the status
		// request itself never reached the server — unknown, not the server's
		// own "no". Treated the same as still-loading (`null` here too): the
		// width-reserving ghost below holds the slot and nothing visible
		// claims a setup state the outage made up. `status.configured ===
		// false` (a real answer) is the only thing that earns the dashed
		// "Not configured" button.
		if (status.configured === null) return null;
		if (!status.configured) return 'unconfigured';
		return status.connected ? 'account' : 'connect';
	});

	// The remembered shape, read once; refreshed whenever the answer changes.
	let hint = $state<Shape | null>(readHint());
	$effect(() => {
		if (shape && shape !== hint) {
			hint = shape;
			try {
				localStorage.setItem(SHAPE_KEY, shape);
			} catch {
				/* private mode: the slot just is not reserved next time */
			}
		}
	});

	async function handleDisconnect() {
		await disconnectGithub();
		await queryClient.invalidateQueries({ queryKey: githubStatusQueryKey });
		// Commit queries are now unauthorized — refresh them too.
		await queryClient.invalidateQueries({ queryKey: ['rollout-commits'] });
	}
</script>

<!--
	⭐ THE SLOT IS RESERVED AT THE WIDTH OF THE SHAPE THAT WILL RENDER, NOT THE
	WIDEST ONE. (LOAD-STATE-AUDIT-2026-09-04 finding 5, then the human the same
	day: "Search and GitHub profile icons moved on the mobile view … they're
	not in the corner anymore.") The first fix stacked all three shapes as
	invisible ghosts so the slot was as wide as the widest — 121px at 390 for a
	signed-in reader whose avatar is 36px, which parked the avatar left of
	85px of nothing and pushed Search with it. Widths differ threefold, so
	"widest" is the wrong reservation for two of the three readers.

	The shape is remembered in localStorage after every answer. While the
	status query is still loading, ONE ghost — the remembered shape — holds the
	slot; on a first-ever visit nothing is remembered and nothing is reserved,
	a one-time insertion. The ghost and the real control are the same snippet,
	so they cannot drift apart in width. While loading, nothing visible renders
	(that decision stays: no spinner, no placeholder text).
-->

{#snippet accountShape(ghost: boolean, login: string, avatarUrl: string | null)}
	<!-- ⛔ ITEM 10 (integration round 3): this used to override
	     `.btn-secondary`'s own border to `!border-transparent` and fill it
	     `!bg-gray-100` — a filled pill, the one icon button in the bar NOT
	     drawing the same bordered-white box `Deploy`/`View on GitHub` do.
	     Height (`!h-9` = 36px) was already right; only the chrome needed to
	     drop back to `.btn-secondary`'s own border token, same as
	     `connectShape` below already does. -->
	<button
		type="button"
		id={ghost ? undefined : menuId}
		tabindex={ghost ? -1 : undefined}
		aria-hidden={ghost ? 'true' : undefined}
		inert={ghost || undefined}
		disabled={ghost || undefined}
		class="btn btn-ghost btn-sm {ghost
			? 'invisible'
			: ''}"
		aria-label="GitHub account"
		title={ghost ? undefined : `Connected as ${login}`}
	>
		{#if ghost}
			<span class="h-6 w-6 shrink-0 rounded-full"></span>
		{:else if avatarUrl}
			<img src={avatarUrl} alt={login} class="h-6 w-6 rounded-full" />
		{:else}
			<GithubSolid class="h-4 w-4" />
		{/if}
		<!-- `max-w-24 truncate` caps the name, so the ghost's long stand-in
		     reserves the same width the real name will. -->
		<span class="hidden max-w-24 truncate sm:inline">{ghost ? 'connected-account-name' : login}</span>
	</button>
{/snippet}

{#snippet connectShape(ghost: boolean)}
	<button
		type="button"
		tabindex={ghost ? -1 : undefined}
		aria-hidden={ghost ? 'true' : undefined}
		inert={ghost || undefined}
		disabled={ghost || undefined}
		class="btn btn-secondary btn-sm max-sm:h-9 max-sm:w-9 max-sm:justify-center max-sm:!border-transparent max-sm:!bg-transparent max-sm:px-0 {ghost
			? 'invisible'
			: ''}"
		onclick={ghost ? undefined : () => connectGithub()}
		aria-label="Connect GitHub"
		title="Connect your GitHub account to see deployed changes"
	>
		<GithubSolid class="h-4 w-4" />
		<!-- icon-only on a phone: the label cost ~60px that the breadcrumb needs (QA #24: "orders-api" read "or…"); the name is the aria-label -->
		<span class="hidden sm:inline">Connect GitHub</span>
	</button>
{/snippet}

{#snippet unconfiguredShape(ghost: boolean)}
	<!-- ⭐ A BUTTON, NOT A SPAN. (2026-09-03, from the human: "github button just
	     says not configured and i cannot seem to click it.") The dashed box
	     LOOKS pressable, so it must do something when pressed — and on a phone
	     there is no hover to reveal the `title`. Pressing it opens the one
	     sentence a reader needs: what is missing and where it is set. -->
	<button
		type="button"
		id={ghost ? undefined : 'github-unconfigured'}
		tabindex={ghost ? -1 : undefined}
		aria-hidden={ghost ? 'true' : undefined}
		inert={ghost || undefined}
		disabled={ghost || undefined}
		class="btn btn-secondary btn-sm cursor-help !border-dashed !text-fg-subtle {ghost
			? 'invisible'
			: ''}"
		aria-label={ghost || !status ? undefined : githubAbsenceSentence(status)}
	>
		<GithubSolid class="h-4 w-4" />
		<span class="sm:hidden">Not set up</span>
		<span class="hidden sm:inline">Not configured</span>
	</button>
{/snippet}

<div class="grid">
	{#if (status === undefined || status?.configured === null) && hint}
		<!-- One ghost, the remembered shape, holds the slot while loading — or
		     while the status request itself failed (`configured === null`,
		     AD palette round 8 item 4): the slot stays reserved, but nothing
		     visible claims a setup state the outage made up. -->
		<div class="col-start-1 row-start-1 flex items-center" aria-hidden="true">
			{#if hint === 'account'}
				{@render accountShape(true, '', null)}
			{:else if hint === 'connect'}
				{@render connectShape(true)}
			{:else}
				{@render unconfiguredShape(true)}
			{/if}
		</div>
	{/if}

	<div class="col-start-1 row-start-1 flex items-center">
		{#if status?.configured}
			{#if status.connected}
				{@render accountShape(false, status.login ?? '', status.avatarUrl ?? null)}
				<Dropdown
					triggeredBy={`#${menuId}`}
					simple
					class="w-44 rounded-lg border border-line bg-overlay [box-shadow:var(--k-shadow-overlay)]"
				>
					<DropdownItem class="t-meta flex items-center gap-2 text-fg-subtle">
						<GithubSolid class="h-3 w-3" />
						Connected as {status.login}
					</DropdownItem>
					<DropdownItem onclick={handleDisconnect} class="t-ui text-fg">Disconnect GitHub</DropdownItem>
				</Dropdown>
			{:else}
				{@render connectShape(false)}
			{/if}
		{:else if status && status.configured === false}
			{@render unconfiguredShape(false)}
			<Popover
				triggeredBy="#github-unconfigured"
				trigger="click"
				class="w-72 rounded-lg border border-line bg-overlay [box-shadow:var(--k-shadow-overlay)] t-body"
				title="GitHub is not configured"
			>
				<p class="text-fg-muted">
					This dashboard has no GitHub App credentials, so there is nothing to sign in to and
					commit lists stay empty.
				</p>
				<p class="mt-2 text-fg-muted">
					Set <code class="t-code-sm">GITHUB_APP_CLIENT_ID</code> and
					<code class="t-code-sm">GITHUB_APP_CLIENT_SECRET</code> on the dashboard — the secret
					<code class="t-code-sm">github-app-credentials</code> in its namespace — and restart it.
				</p>
			</Popover>
		{/if}
	</div>
</div>
