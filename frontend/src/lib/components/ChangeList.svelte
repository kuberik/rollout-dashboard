<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ "WHAT CHANGED" — AND IT NEVER EXPANDS TO NOTHING.
	 *
	 * ── WHY THIS EXISTS, AND WHY IT IS NOT `CommitSummary` ──────────────────
	 *
	 * From a live UX critique of `/activity`:
	 *
	 * > *"Clicking `Show changes` flips the label to `Hide changes` and reveals
	 * > ZERO content. It is the only affordance answering 'what changed?', the
	 * > operator's most common question, and it silently produces an empty
	 * > expander."*
	 *
	 * The mechanism was not a bug. `CommitSummary` renders **deliberately
	 * nothing** on error, and its own comment says why: it is designed for a
	 * page that draws one per row unattended, where an error string repeated
	 * forty times *"is how a page comes to look broken on arrival"*. That is
	 * correct — for an ambient object nobody asked for.
	 *
	 * **This is the opposite situation.** A reader PRESSED a control. An
	 * explicit request earns an explicit answer, and a control that does
	 * nothing is worse than no control. So the two objects are separated
	 * rather than merged: `CommitSummary` stays exactly as it is for the
	 * ambient case, and the on-demand case gets a component whose contract is
	 * that **every branch renders something a person can act on.**
	 *
	 * ── THE FOUR BRANCHES, AND THE ESCAPE HATCH ─────────────────────────────
	 *
	 *   loading      a skeleton bar — "not here yet", not a sentence to parse
	 *   commits      the list: sha, subject, author
	 *   none         "These two versions have the same commits." — a real answer
	 *   unavailable  ONE plain sentence naming the reason, plus the way out
	 *
	 * The way out is the load-bearing part. On the live cluster
	 * `/api/auth/github/status` reports `configured: false` — the server has no
	 * GitHub App at all, so *"Connect GitHub"* would be a second dead control.
	 * But **the answer does not actually need kuberik's GitHub token**: the
	 * rollout carries `status.source`, and `github.com/<owner>/<repo>/compare/
	 * <base>...<head>` is a public URL that answers the question directly. So
	 * the failure branch ships the question's ANSWER, not an apology.
	 *
	 * `Connect GitHub` is offered only when the server says the app IS
	 * configured and the user simply has not connected — the one case where
	 * pressing it changes the outcome.
	 *
	 * ── NO POLLING, NO RETRY ────────────────────────────────────────────────
	 *
	 * Same reasoning `CommitSummary` records: an auth failure cannot be retried
	 * or polled into success, and a commit range is immutable, so there is
	 * nothing to poll for on success either. The query is also `enabled` only
	 * while the panel is OPEN, so a 60-row feed fires zero requests until
	 * somebody asks a question.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import {
		CodeBranchSolid,
		GithubSolid,
		ChevronDownOutline,
		ChevronUpOutline
	} from 'flowbite-svelte-icons';
	import {
		commitsQueryOptions,
		fetchGithubStatus,
		githubStatusQueryKey,
		connectGithub,
		formatCommitMessage,
		FetchCommitsError,
		type CommitInfo
	} from '$lib/api/github';

	let {
		namespace,
		name,
		cluster = undefined,
		base = null,
		head = null,
		source = null,
		class: className = ''
	}: {
		namespace: string;
		name: string;
		cluster?: string;
		/** The revision this deploy replaced. */
		base?: string | null;
		/** The revision this deploy put live. */
		head?: string | null;
		/** `rollout.status.source` — the repo URL, in any of its spellings. */
		source?: string | null;
		class?: string;
	} = $props();

	let open = $state(false);

	const rangeOk = $derived(!!namespace && !!name && !!base && !!head && base !== head);

	const statusQuery = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 60_000,
		refetchInterval: false as const
	}));

	const query = createQuery(() =>
		commitsQueryOptions({ namespace, name, base, head, cluster, enabled: open })
	);

	const commits = $derived<CommitInfo[]>(query.data?.commits ?? []);

	/**
	 * The public compare URL. `status.source` arrives as an https URL, an ssh
	 * URL (`git@github.com:Owner/repo.git`) or with a trailing `.git` — the
	 * same three spellings `version-utils.normalizeSource` already handles.
	 * Returns null for anything that is not github.com, because a compare path
	 * is GitHub's, not every forge's.
	 */
	const compareUrl = $derived.by<string | null>(() => {
		if (!source || !base || !head) return null;
		let s = source.trim();
		const ssh = s.match(/^[\w.-]+@([\w.-]+):(.+)$/);
		if (ssh) s = `https://${ssh[1]}/${ssh[2]}`;
		else if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
		s = s.replace(/\.git\/?$/, '').replace(/\/+$/, '');
		if (!/^https:\/\/(www\.)?github\.com\/[^/]+\/[^/]+$/i.test(s)) return null;
		return `${s}/compare/${base}...${head}`;
	});

	/** One sentence, in ordinary English, naming why the list is not here. */
	const reason = $derived.by<string | null>(() => {
		const err = query.error;
		if (!err) return null;
		if (err instanceof FetchCommitsError) {
			if (err.reason === 'not_connected') {
				return statusQuery.data?.configured === false
					? 'This kuberik has no GitHub connection set up, so it cannot list the commits itself.'
					: 'kuberik cannot read this repository until you connect your GitHub account.';
			}
			if (err.reason === 'no_access') {
				return 'Your GitHub account cannot read this repository.';
			}
		}
		return `GitHub did not answer: ${(err as Error).message}`;
	});

	const canConnect = $derived(
		statusQuery.data?.configured === true && statusQuery.data?.connected !== true
	);

	const panelId = `changelist-${Math.random().toString(36).slice(2, 9)}`;

	/**
	 * ⭐ THE TRIGGER GRAMMAR IS `lib/disclosure.ts`'s, NOT AN INTERROGATIVE.
	 * (2026-09-02) `What changed` is a question; `src/lib/CLAUDE.md`'s rule is
	 * "a SET you can count, of one kind → `N <noun>`" and this control opens
	 * onto exactly that — a list of commits. Before the count is known
	 * (unopened, still loading, or the fetch failed) there is nothing to
	 * count yet, and the grammar's own fallback for that case is `Details` —
	 * not a guess, not a re-print of the question.
	 *
	 * ⚠️ `query.data` is the guard, not `commits.length` — an honestly EMPTY
	 * range (`0 commit${''}`) is still a known count and must say `0 commits`,
	 * not fall back to `Details` because `[].length` is falsy.
	 */
	const commitCount = $derived<number | null>(query.data ? query.data.commits.length : null);
	const triggerLabel = $derived(
		commitCount !== null ? `${commitCount} commit${commitCount === 1 ? '' : 's'}` : 'Details'
	);
</script>

{#if rangeOk}
	<!-- ⭐ `display: contents`, NOT A BOX. (DESIGN PASS 2, defect #2) `/activity`
	     used to render this whole component in its own indented block BELOW
	     the row — always a second line, on every entry, whether or not the
	     row's first line had room to spare. Measured: rows that had 49% of
	     their first line unpainted still forced an 83px-tall second line for
	     this control alone.

	     The caller now places `<ChangeList>` INLINE among the row's other
	     first-line facts (state word, rollback mark, actor) instead of below
	     them. `contents` makes that possible without a second wrapper fighting
	     the parent's own `flex flex-wrap` — the trigger `<button>` and the
	     (conditional) panel become direct flex items of THAT row, so the
	     trigger sits on line 1 when there is room and the panel still forces
	     its own full-width line via `basis-full` when opened. `class` is kept
	     for API compatibility but is inert under `contents` — no caller passes
	     one today. -->
	<div class="contents {className}">
		<!-- `/activity` renders this control ~20 times on one screen. Before the
		     `aria-label`, the links-and-buttons list a screen reader gives read
		     the SAME visible words twenty times over with nothing to tell them
		     apart — true whether those words are the old interrogative or the
		     count-noun trigger below. The `aria-label` does not track
		     `triggerLabel`: the row above already says which deploy this is,
		     and a sighted reader has that row. -->
		<button
			type="button"
			onclick={() => (open = !open)}
			aria-expanded={open}
			aria-controls={panelId}
			aria-label={`What changed in ${name}${head ? ` at ${head.slice(0, 7)}` : ''}`}
			class="t-micro inline-flex shrink-0 items-center gap-1 rounded text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
		>
			<CodeBranchSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
			{triggerLabel}
			{#if open}
				<ChevronUpOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
			{:else}
				<ChevronDownOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
			{/if}
		</button>

		{#if open}
			<!-- `basis-full`: forces this panel onto its OWN line inside the
			     parent's `flex flex-wrap` row, whatever room the trigger left
			     behind on line 1 — a wide bordered box has no business sharing a
			     line with `[ENV] name · state · N commits`.

			     ⚠️ `relative z-[1]`: THE CALLER'S ROW IS A `.tap-zone` NOW.
			     `/activity` moved this component inside the row's own
			     `.tap-zone` so the trigger could sit on line 1 (`.tap-zone`
			     only auto-raises `a`/`button`/etc., which covers the trigger
			     and every link inside this panel, but NOT the plain commit-
			     subject text) — and `.tap-zone`'s tap-link draws its overlay at
			     `z-index: 0` over the whole zone, which is exactly the
			     mechanism the ORIGINAL comment here warned about: "a tap zone
			     makes its own text unselectable, and that panel is a list of
			     commit subjects an operator copies." Raising the whole panel
			     one stacking level, the same way `.tap-zone`'s own rule raises
			     a button, keeps every commit subject selectable again. -->
			<div
				id={panelId}
				class="relative z-[1] mt-2 w-full basis-full rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
			>
				{#if query.isLoading}
					<span
						class="inline-block h-3 w-40 max-w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700"
						aria-hidden="true"
					></span>
				{:else if query.isError}
					<!-- THE BRANCH THAT USED TO RENDER NOTHING. -->
					<p class="t-dense text-gray-700 dark:text-gray-200">{reason}</p>
					<!-- ⭐ ONE DESTINATION, ONE TREATMENT. (2026-09-02) `See the diff
					     on GitHub` was a `.btn` in THIS branch and a plain text link
					     in the success branch ninety lines below — the same URL
					     drawn two ways inside one component. It is navigation in
					     both, so it is a link in both, and that leaves `Connect
					     GitHub` beside it as the only boxed control: which is
					     correct, because it is the only one that changes anything. -->
					<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
						{#if compareUrl}
							<a href={compareUrl} target="_blank" rel="noopener noreferrer" class="nav-link">
								<GithubSolid aria-hidden="true" />
								See the diff on GitHub
							</a>
						{/if}
						{#if canConnect}
							<button type="button" class="btn btn-secondary" onclick={() => connectGithub()}>
								<GithubSolid aria-hidden="true" />
								Connect GitHub
							</button>
						{/if}
					</div>
				{:else if commits.length === 0}
					<p class="t-dense text-gray-700 dark:text-gray-200">
						Nothing changed in the source between these two versions.
					</p>
				{:else}
					<p class="t-micro mb-2 text-gray-500 dark:text-gray-400">
						{commits.length} commit{commits.length === 1 ? '' : 's'} went live here
					</p>
					<ul class="space-y-1">
						{#each commits as c (c.sha)}
							<li class="flex items-baseline gap-2">
								<a
									href={c.url}
									target="_blank"
									rel="noopener noreferrer"
									class="t-code-sm shrink-0 text-blue-700 hover:underline dark:text-blue-400"
									>{(c.sha ?? '').slice(0, 7)}</a
								>
								<span class="t-micro min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200"
									>{formatCommitMessage(c.message)}</span
								>
								{#if c.author}
									<span class="t-micro shrink-0 text-gray-500 dark:text-gray-400">{c.author}</span>
								{/if}
							</li>
						{/each}
					</ul>
					{#if compareUrl}
						<a
							href={compareUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="t-micro mt-2 inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
						>
							<GithubSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
							See the full diff on GitHub
						</a>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
{/if}
