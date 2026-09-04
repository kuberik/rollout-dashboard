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

	async function handleDisconnect() {
		await disconnectGithub();
		await queryClient.invalidateQueries({ queryKey: githubStatusQueryKey });
		// Commit queries are now unauthorized — refresh them too.
		await queryClient.invalidateQueries({ queryKey: ['rollout-commits'] });
	}
</script>

<!--
	⭐ ARITY-STABLE SLOT (LOAD-STATE-AUDIT-2026-09-04, finding 5). This control
	cannot pick its shape until `/api/auth/github/status` answers, and while
	loading it renders NOTHING — that decision is deliberate and stays (see
	the note below this one): a confident wrong placeholder is worse than an
	honest blank one, and there's no spinner-worthy latency here. What WAS
	broken is the IMPLEMENTATION of "nothing": it meant zero width until the
	query resolved, so `Search` — this control's left neighbour in the
	navbar's right-hand flex group — slid −166px at 1440 / −113px at 390 the
	instant the answer landed (a 36px tap target moving 113px under a
	finger).

	The fix reserves the slot from FIRST PAINT, at the exact width the real
	content will need, without a hand-picked pixel constant: all three
	possible shapes (connected avatar/menu, "Connect GitHub", "Not
	configured") are stacked in the same CSS grid cell — `col-start-1
	row-start-1` on every one of them — as `invisible` + `inert` +
	`aria-hidden` ghosts. An invisible grid item still participates in track
	sizing exactly like a visible one, so the container is, from the very
	first frame, exactly as wide (and tall) as its widest possible resident.
	The real content — one shape, or nothing while `status` is still loading
	— sits in the SAME cell on top. Ghosts are never focusable, never
	announced, never clickable (`tabindex="-1"`, `disabled`, `inert`,
	`aria-hidden="true"`): they exist only to hold the door open.
-->
<div class="grid">
	<!-- Ghosts. Order doesn't matter — they all occupy grid cell (1,1). -->
	<button
		type="button"
		tabindex="-1"
		aria-hidden="true"
		inert
		disabled
		class="invisible col-start-1 row-start-1 t-button flex items-center gap-2 rounded bg-gray-100 p-1 pr-2 dark:bg-gray-700"
	>
		<span class="h-6 w-6 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600"></span>
		<!-- `max-w-24 truncate` in the real markup caps this regardless of the
		     actual username, so any string long enough to overflow it reserves
		     the same width the real one will. -->
		<span class="hidden max-w-24 truncate sm:inline">connected-account-name</span>
	</button>
	<button
		type="button"
		tabindex="-1"
		aria-hidden="true"
		inert
		disabled
		class="invisible col-start-1 row-start-1 t-button flex items-center gap-2 rounded border border-gray-200 bg-transparent px-3 py-1 dark:border-gray-700"
	>
		<GithubSolid class="h-4 w-4" />
		<span class="sm:hidden">Connect</span>
		<span class="hidden sm:inline">Connect GitHub</span>
	</button>
	<button
		type="button"
		tabindex="-1"
		aria-hidden="true"
		inert
		disabled
		class="invisible col-start-1 row-start-1 t-button flex items-center gap-2 rounded border border-dashed border-gray-200 bg-transparent px-3 py-1 dark:border-gray-700"
	>
		<GithubSolid class="h-4 w-4" />
		<span class="sm:hidden">Not set up</span>
		<span class="hidden sm:inline">Not configured</span>
	</button>

	<!--
		Real content, in the same grid cell. No spinner, no placeholder text —
		only the width (and height) above is real; this is either nothing
		(loading) or exactly one of the three shapes the ghosts already sized
		for.

		⭐ CONFIGURED: FALSE USED TO RENDER NOTHING HERE — INDISTINGUISHABLE FROM
		"HASN'T LOADED YET". (2026-09-03, from the human: "there's no way to login
		to GitHub on mobile.") This is the ONLY GitHub control anywhere on the
		product's chrome (the bottom tab bar has no overflow menu; every other
		surface's GitHub-absence sentence is plain text). A reader with no other
		way to learn WHY there is no connect control had no way to learn it —
		only that there wasn't one, same as a dashboard where GitHub was never a
		feature at all. `status === undefined` (still loading) still renders
		nothing, so there's no flash before the first answer arrives.

		⭐ AND BELOW `sm` THE BUTTON WAS A BARE GLYPH. (2026-09-03, follow-on, from
		the coordinator relaying the same human report.) `<span class="hidden
		sm:inline">Connect GitHub</span>` left nothing but `GithubSolid` visible
		at 390 — a mark that reads as "this app integrates with GitHub somehow",
		not as "press this to log in". A hidden `aria-label` fixes screen readers,
		not a thumb scanning a toolbar. Both states below now print a SHORT label
		at every width instead of going icon-only below `sm` — "Connect" / "Not
		set up" under 640px, the full "Connect GitHub" / "Not configured" at
		`sm+` — sized against the navbar's other controls (Search, this, theme
		toggle) at 390 with room to spare; see verification notes for the
		measured boxes.
	-->
	<div class="col-start-1 row-start-1 flex items-center">
		{#if status?.configured}
			{#if status.connected}
				<button
					type="button"
					id={menuId}
					class="t-button flex items-center gap-2 rounded bg-gray-100 p-1 pr-2 text-gray-800 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
					aria-label="GitHub account"
					title={`Connected as ${status.login}`}
				>
					{#if status.avatarUrl}
						<img src={status.avatarUrl} alt={status.login} class="h-6 w-6 rounded-full" />
					{:else}
						<GithubSolid class="h-4 w-4" />
					{/if}
					<span class="hidden max-w-24 truncate sm:inline">{status.login}</span>
				</button>
				<Dropdown triggeredBy={`#${menuId}`} simple class="w-44">
					<DropdownItem class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
						<GithubSolid class="h-3.5 w-3.5" />
						Connected as {status.login}
					</DropdownItem>
					<DropdownItem onclick={handleDisconnect} class="text-sm">Disconnect GitHub</DropdownItem>
				</Dropdown>
			{:else}
				<button
					type="button"
					class="t-button flex items-center gap-2 rounded border border-gray-200 bg-transparent px-3 py-1 text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
					onclick={() => connectGithub()}
					aria-label="Connect GitHub"
					title="Connect your GitHub account to see deployed changes"
				>
					<GithubSolid class="h-4 w-4" />
					<span class="sm:hidden">Connect</span>
					<span class="hidden sm:inline">Connect GitHub</span>
				</button>
			{/if}
		{:else if status && !status.configured}
			<!-- ⭐ A BUTTON, NOT A SPAN. (2026-09-03, from the human: "github button just
			     says not configured and i cannot seem to click it.") The dashed box
			     LOOKS pressable, so it must do something when pressed — and on a phone
			     there is no hover to reveal the `title`. Pressing it opens the one
			     sentence a reader needs: what is missing and where it is set. The
			     label stays short so the control keeps `Connect GitHub`'s footprint. -->
			<button
				type="button"
				id="github-unconfigured"
				class="t-button flex cursor-help items-center gap-2 rounded border border-dashed border-gray-200 bg-transparent px-3 py-1 text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-500 dark:border-gray-700 dark:text-gray-500 dark:hover:border-gray-600 dark:hover:text-gray-400"
				aria-label={githubAbsenceSentence(status)}
			>
				<GithubSolid class="h-4 w-4" />
				<span class="sm:hidden">Not set up</span>
				<span class="hidden sm:inline">Not configured</span>
			</button>
			<Popover triggeredBy="#github-unconfigured" trigger="click" class="w-72 text-sm" title="GitHub is not configured">
				<p class="text-gray-600 dark:text-gray-300">
					This dashboard has no GitHub App credentials, so there is nothing to sign in to and
					commit lists stay empty.
				</p>
				<p class="mt-2 text-gray-600 dark:text-gray-300">
					Set <code class="t-code-sm">GITHUB_APP_CLIENT_ID</code> and
					<code class="t-code-sm">GITHUB_APP_CLIENT_SECRET</code> on the dashboard — the secret
					<code class="t-code-sm">github-app-credentials</code> in its namespace — and restart it.
				</p>
			</Popover>
		{/if}
	</div>
</div>
