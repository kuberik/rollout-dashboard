<svelte:options runes={true} />

<script lang="ts">
	import { GithubSolid } from 'flowbite-svelte-icons';
	import { Dropdown, DropdownItem } from 'flowbite-svelte';
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
	<!-- Nothing here would ever do anything different when pressed, so it is
	     a muted, non-interactive affordance rather than a button. The
	     ACCESSIBLE name and the hover `title` carry the full canonical
	     sentence — the same one every other GitHub-absence surface in the
	     product uses (`githubAbsenceSentence`) — so it reads identically to
	     a screen reader or on hover regardless of viewport. The printed
	     label stays short ("Not set up" / "Not configured") to match
	     `Connect GitHub`'s own footprint at every width, same reasoning as
	     the button above; the full sentence is one tap/hover away via
	     `title`/aria-label either way. -->
	<span
		class="t-button flex cursor-default items-center gap-2 rounded border border-dashed border-gray-200 bg-transparent px-3 py-1 text-gray-400 dark:border-gray-700 dark:text-gray-500"
		aria-label={githubAbsenceSentence(status)}
		title={githubAbsenceSentence(status)}
	>
		<GithubSolid class="h-4 w-4" />
		<span class="sm:hidden">Not set up</span>
		<span class="hidden sm:inline">Not configured</span>
	</span>
{/if}
