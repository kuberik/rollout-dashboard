<svelte:options runes={true} />

<script lang="ts">
	import { availableReleases } from '$lib/releases/registry.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { CodeBranchSolid, ChevronRightOutline, UndoOutline } from 'flowbite-svelte-icons';
	import {
		commitsQueryOptions,
		formatCommitMessage,
		type CommitInfo
	} from '$lib/api/github';
	import Avatar from './Avatar.svelte';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { commitPullsQueryOptions } from '$lib/api/commit-pulls';

	interface Props {
		namespace: string;
		name: string;
		// Commit range to summarize (oldest → newest). When base === head or
		// either is missing, the component renders nothing.
		base?: string | null;
		head?: string | null;
		cluster?: string;
		// 'forward' = commits deployed, 'rollback' = commits reverted. Affects
		// wording + dot color only.
		direction?: 'forward' | 'rollback';
		// Override the wording after the count (e.g. "behind staging"). Defaults
		// to "deployed"/"reverted" based on direction.
		verb?: string;
		// Show a stacked cluster of unique contributor avatars.
		showAvatars?: boolean;
		// Show the +additions / −deletions stat.
		showStats?: boolean;
		// Optional link target; when set the WHOLE summary line becomes one tap
		// target pointing at it (see the note above the markup).
		href?: string;
		/* What the link goes to, APPENDED TO THE COUNT rather than replacing it.
		   An `aria-label` overrides an element's own text, so the label alone
		   spent the whole accessible name on the destination and a screen-reader
		   user tabbing here heard *"See these commits in the deploy history"* —
		   the one thing the sighted reader gets, `3 commits deployed`, was the
		   thing that got dropped. Ignored without `href`. */
		hrefLabel?: string;
		// Muted "nothing to show" states can be hidden entirely (e.g. inline in a
		// dense list where an empty row would be noise).
		hideWhenEmpty?: boolean;
		// Render each commit's message as a list below the summary line.
		showMessages?: boolean;
		/** `showMessages` only: draw the commit rows only when the range has at least this many
		 *  commits (the Newer builds opened row passes 2: one commit's row would repeat the title it
		 *  already sits under, so the line stays the count, the +/- and the files). */
		messagesMin?: number;
		/**
		 * ⭐ ROUND 2 — THE NEWER-BUILDS ROW NEEDS A SECOND KIND OF COMPACT.
		 * (2026-10-08, coordinator review: "two emphases only" — drop the
		 * diffstat/count/avatars from a release-candidate row, keep only the
		 * newest commit's own title.) `true` skips the dot/branch-icon/count
		 * line entirely and renders ONE line — the newest commit's message
		 * (truncated) · its author — in `t-body`/`t-meta`, no stats, no
		 * avatars, no `showMessages` list. Mutually exclusive with
		 * `showMessages`/`showStats`/`showAvatars`, which this ignores.
		 */
		singleLine?: boolean | 'slots';
		/**
		 * `singleLine="slots"` (owner §7, 2026-11-02): the same one commit, drawn as
		 * two roles in two grid tracks instead of an inline run — the title in ink
		 * (`t-ui`, truncating; takes `class`) and the author as `Avatar 16` + login
		 * (`t-meta`; takes `authorClass`, which must set its own `display`/placement).
		 * The caller's grid owns the tracks; this renders only the two children.
		 */
		authorClass?: string;
		/** `slots` only: the title's ink. The Newer builds ledger draws the newest build's title in
		 *  `fg` and the older ones in `fg-muted` (r34 newer-builds pick A: three tiers, not seven equal rows). */
		titleTone?: 'fg' | 'muted';
		/* ⛔ THERE WAS AN `expandable` PROP HERE AND IT IS DELETED, NOT DEPRECATED.
		   (2026-09-02) It made the summary line a disclosure that unfolded the
		   commit list in place, and it lost its last caller when rollout detail's
		   status card gave up its disclosure to become a rollup pointing at the
		   History tab. Three call sites remained — rollout detail, the History
		   tab, `/versions/<rev>` — and none of them passed it, so every branch it
		   guarded was unreachable code that still had to be read, kept true and
		   styled in both themes.

		   It is deleted rather than kept "in case", which is the habit that
		   produced two joined-badge implementations in this repo. `showMessages`
		   already renders the list, and the product's answer for a tail is to
		   give it away to the page that owns it — `href` plus the chevron below,
		   which is `Show 8 ready resources ›` one card over. If an inline
		   disclosure is ever wanted again, it needs a call site first. */
		// When provided, only include commits whose sha matches one of these
		// available-release revisions — filtering out intermediate commits that
		// never became a release.
		releaseShas?: string[];
		/**
		 * ⭐ `'neutral'` FOR A FAILED DEPLOY'S OWN PANEL (History round 14,
		 * AD round 10, D6 nit): "no green dot on '1 commit deployed' inside
		 * a failed deploy." The dot's green is this product's ONE green —
		 * reserved for "this went fine" — and `direction`/`effectiveDirection`
		 * only ever turn it neutral for a ROLLBACK, never for a deploy that
		 * simply failed; a commit range can still be "forward" (nothing was
		 * reverted) on a build whose health check failed, which is exactly
		 * History's failed row. Defaults to `'auto'` (unchanged everywhere
		 * else this component is used) so only History's one failed-entry
		 * call site opts in.
		 */
		dotTone?: 'auto' | 'neutral';
		/**
		 * ⭐ `headline` — THE ROLLOUT TABS' HEADER LINE (r34 tabs-nb round 2). Role: "what is deployed
		 * here, in the owner's words" under the page header, not a count of commits. It reads the
		 * build's TITLE: `#n Title` when the head commit maps to exactly ONE pull request, else the
		 * head commit's message — never both, never "1 commit deployed" — then the author face(s),
		 * the ± lines and the file count, the whole line one tap target (`href`). Below 640px the
		 * title is line 1 and the stats line 2 (always two lines, so the slot's height can be
		 * reserved). Borrows its proportions from the `singleLine` slots row (t-ui-sm title, t-code-sm
		 * stats). Ignored with `singleLine`.
		 */
		headline?: boolean;
		/** `showMessages` only: draw each commit row with its author's Avatar (16) before the login —
		 *  one face per login, the same field `singleLine="slots"` and the header read. */
		rowAvatars?: boolean;
		/** `showMessages` only: show this many commit rows, then ONE `.btn-secondary` "N more" fold. */
		messageLimit?: number;
		/** `showMessages` only: skip the summary line and draw just the rows (the stats line is the
		 *  caller's). */
		listOnly?: boolean;
		/** `headline` only: the number of the ONE pull request the head commit maps to (null while
		 *  unknown or when it maps to none/several) -- the page header links its build to that change. */
		headPullNumber?: number | null;
		class?: string;
	}

	let {
		namespace,
		name,
		base = null,
		head = null,
		cluster,
		direction = 'forward',
		verb,
		showAvatars = false,
		showStats = true,
		href,
		hrefLabel,
		hideWhenEmpty = false,
		showMessages = false,
		messagesMin = 1,
		singleLine = false,
		authorClass = '',
		titleTone = 'fg',
		releaseShas,
		dotTone = 'auto',
		headline = false,
		rowAvatars = false,
		messageLimit = 0,
		listOnly = false,
		headPullNumber = $bindable<number | null>(null),
		class: className = ''
	}: Props = $props();

	let showAllRows = $state(false);

	const enabled = $derived(!!namespace && !!name && !!base && !!head && base !== head);

	// CORRECTNESS, not polish. Left to the app-wide defaults
	// (`refetchInterval: 5000`, `retry: 3`), a page with one of these per row
	// produced roughly 140 failed /commits requests a minute for an
	// unauthenticated user — over GitHub's entire authenticated budget — and
	// every one of those rows rendered "Loading changes…" forever, because the
	// unauthenticated state was being drawn as a loading state.
	//
	// The policy now lives in `commitsQueryOptions` so all four callers share
	// it: never polled, never retried on an auth failure, and a sha-to-sha
	// range — which cannot change — is never refetched at all.
	const query = createQuery(() => commitsQueryOptions({ namespace, name, base, head, cluster }));

	// Available-release revisions for this rollout, fetched here so every commit
	// display filters to release commits automatically (DRY) — callers don't
	// thread the list. Cached by TanStack, so it's typically free on pages that
	// already loaded the rollout. An explicit `releaseShas` prop overrides it.
	const rolloutQuery = createQuery(() => ({
		...rolloutQueryOptions({ namespace, name, cluster }),
		enabled,
		// Available releases change on the order of minutes; a 5s poll per
		// visible row is pure waste. Other observers of the same key (the
		// rollout detail page) keep their own faster interval.
		staleTime: 60_000,
		refetchInterval: false as const
	}));
	const releaseShasEffective = $derived<string[]>(
		releaseShas ??
			((availableReleases(rolloutQuery.data?.rollout) ?? [])
				.map((r) => r.revision)
				.filter((s): s is string => !!s) as string[])
	);

	const data = $derived(query.data);
	// When `releaseShas` is provided, keep only commits that are themselves an
	// available release (match by sha prefix, since a release revision may be
	// stored short). Otherwise show every commit in the range.
	const commits = $derived.by<CommitInfo[]>(() => {
		const all = data?.commits ?? [];
		if (!releaseShasEffective || releaseShasEffective.length === 0) return all;
		const rels = releaseShasEffective.filter(Boolean).map((s) => s.toLowerCase());
		return all.filter((c) => {
			const sha = (c.sha ?? '').toLowerCase();
			return rels.some((r) => sha.startsWith(r) || r.startsWith(sha));
		});
	});
	const count = $derived(commits.length);
	// The server infers direction from the range, so rollbacks read as "reverted"
	// on every surface without the caller knowing. `direction`/`verb` props are
	// only fallbacks / overrides (e.g. #4's "behind staging").
	const effectiveDirection = $derived(data?.direction ?? direction);
	const verbText = $derived(verb ?? (effectiveDirection === 'rollback' ? 'reverted' : 'deployed'));
	// The ONE green. `green-500` was a second one in a product allowed exactly one.
	// ⭐ NEVER ORANGE FOR "REVERTED" (AD round 6, nits, History): `held`
	// (`bg-held-solid`) is this product's ONE orange, reserved for the Held
	// state alone (§2.5/DESIGN-LANGUAGE's "one meaning per hue") — "4 commits
	// reverted" is a plain, neutral fact about a compare's own direction, not
	// a blocked rollout, so it takes the same neutral dot `ChangeVersionModal`
	// and `FleetRow` already use for a non-hue fact (`bg-line-strong`).
	const dotClass = $derived(
		dotTone === 'neutral' || effectiveDirection === 'rollback' ? 'bg-line-strong' : 'bg-success-solid'
	);

	// Unique contributors, most-recent-first, capped for display.
	const contributors = $derived.by(() => {
		const seen = new Set<string>();
		const out: CommitInfo[] = [];
		for (const c of commits) {
			const key = c.author || c.sha;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(c);
		}
		return out;
	});

	// ── headline mode: the head commit, and the ONE pull request it maps to ──────────────────
	// `commits` is the range oldest → newest, so the head is the commit whose sha is `head`'s
	// prefix, else the last one. Owner/repo come from that commit's own html url (no new prop).
	const headCommit = $derived.by<CommitInfo | undefined>(() => {
		if (!headline || commits.length === 0) return undefined;
		const h = (head ?? '').toLowerCase();
		return (
			commits.find((c) => {
				const sha = (c.sha ?? '').toLowerCase();
				return !!h && !!sha && (sha.startsWith(h) || h.startsWith(sha));
			}) ?? commits[commits.length - 1]
		);
	});
	const headRepo = $derived.by(() => {
		const m = (headCommit?.url ?? '').match(/github\.com\/([^/]+)\/([^/]+)\/commit\//);
		return m ? { owner: m[1], repo: m[2] } : null;
	});
	const pullsQuery = createQuery(() =>
		commitPullsQueryOptions({
			owner: headRepo?.owner ?? '',
			repo: headRepo?.repo ?? '',
			sha: headCommit?.sha ?? '',
			cluster,
			enabled: headline && !!headRepo && !!headCommit
		})
	);
	const headPull = $derived(pullsQuery.data?.length === 1 ? pullsQuery.data[0] : undefined);
	$effect(() => {
		headPullNumber = headline && headPull ? headPull.number : null;
	});
	const headTitle = $derived(
		headPull
			? `#${headPull.number} ${headPull.title}`
			: headCommit
				? formatCommitMessage(headCommit.message)
				: ''
	);
	// Wait for the pulls answer (or its failure) before drawing the title, so "commit message" never
	// flashes into "#n Title" — the slot shows its skeleton meanwhile.
	const headSettled = $derived(!(headRepo && pullsQuery.isPending));
	const visibleRows = $derived.by<CommitInfo[]>(() => {
		const rows = [...commits].reverse();
		return messageLimit > 0 && !showAllRows ? rows.slice(0, messageLimit) : rows;
	});
</script>

<!-- Three states, and only three:
       loading  -> a skeleton bar, so it reads as "not here yet" instead of
                   as a sentence the operator has to parse and dismiss;
       error    -> NOTHING. Never a per-row status string. Whatever went
                   wrong went wrong identically for every row, and saying
                   it N times is how a page comes to look broken on
                   arrival. `GithubConnectButton` already lives in the
                   navbar, and a page that renders many of these should
                   surface ONE panel-level "Connect GitHub" row;
       empty    -> nothing. -->
{#if enabled}
	{#if query.isLoading}
		{#if headline}
			<span class="flex h-5 items-center max-sm:h-10 max-sm:items-start" aria-hidden="true"
				><span class="mt-1 inline-block h-3 w-48 max-w-full animate-pulse rounded-xs bg-line"></span></span
			>
		{:else}
			<span
				class="inline-block {singleLine === 'slots' ? 'h-4 w-40' : 'h-3 w-32'} max-w-full animate-pulse rounded-xs bg-line {className}"
				aria-hidden="true"
			></span>
		{/if}
	{:else if query.isError}
		<!-- deliberately empty -->
	{:else if count === 0}
		{#if !hideWhenEmpty}
			<span class="t-meta text-fg-subtle {className}">No commit changes</span>
		{/if}
	{:else if singleLine}
		<!-- ⭐ THE NEWER-BUILDS ROW'S "two emphases only" LINE. (2026-10-08,
		     round 2) The newest commit's own title, one line, truncated —
		     not the count, not the diffstat, not the faces. `commits` is
		     newest-first (the range's own order), so `[0]` is the commit
		     this build actually leads with. -->
		{@const latest = commits[0]}
		{#if latest && singleLine === 'slots'}
			<span class="t-body min-w-0 truncate {titleTone === 'muted' ? 'text-fg-muted' : 'text-fg'} {className}">
				{formatCommitMessage(latest.message)}
			</span>
			{#if latest.author}
				<!-- The face is drawn from the SAME login the label names (never a src
				     that belongs to someone else); the viewer is drawn like anyone (owner ruling 3). -->
				<span class="min-w-0 items-center gap-1.5 {authorClass}" title={latest.author}>
					<Avatar name={latest.author} src={latest.avatarUrl ?? null} size={16} />
				</span>
			{/if}
		{:else if latest}
			<span class="t-body min-w-0 basis-full truncate text-fg-muted sm:basis-auto {className}">
				{formatCommitMessage(latest.message)}
			</span>
			{#if latest.author}
				<!-- No literal "·": the one caller (Newer builds) wraps this in
				     `.dot-list`, which draws the separator and never orphans it. -->
				<span class="t-meta shrink-0 text-fg-subtle">{latest.author}</span>
			{/if}
		{/if}
	{:else if headline && headCommit}
		{#if !headSettled}
			<span class="flex h-5 items-center max-sm:h-10 max-sm:items-start" aria-hidden="true"
				><span class="mt-1 inline-block h-3 w-48 max-w-full animate-pulse rounded-xs bg-line"></span></span
			>
		{:else}
			<!-- Same tap-zone pattern as the count line below: the title anchor's ::after covers the
			     whole line, so title, face and stats are one destination. -->
			<!-- ONE shape at every width (r34 tabs-nb r3 #1/E): a full-width row. >=640 it is a flex run
			     (face, title, stats + chevron right behind it; wraps only when the column cannot hold both); below 640 a two-column
			     grid, face in column 1 spanning both lines, the title and the stats line in column 2 --
			     so line 2 ("+39 -24 . 3 files") starts at the TITLE's x, never under the face. -->
			<span
				class="max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)] sm:flex sm:min-h-5 sm:flex-wrap sm:items-center sm:gap-x-2 {href ? 'tap-zone' : ''} {className}"
			>
				<span class="max-sm:contents sm:flex sm:min-w-0 sm:shrink sm:items-center sm:gap-1.5">
					{#if contributors.length > 0}
						<span
							class="flex shrink-0 items-center -space-x-1 max-sm:col-start-1 max-sm:row-span-2 max-sm:row-start-1 max-sm:mr-1.5 max-sm:self-start max-sm:pt-0.5"
						>
							{#each contributors.slice(0, 3) as c (c.author || c.sha)}
								<Avatar name={c.author || 'unknown'} src={c.avatarUrl ?? null} size={16} />
							{/each}
						</span>
					{/if}
					<svelte:element
						this={href ? 'a' : 'span'}
						{href}
						aria-label={href ? (hrefLabel ? `${headTitle}. ${hrefLabel}` : undefined) : undefined}
						class="t-ui-sm min-w-0 truncate text-fg-muted max-sm:col-start-2 max-sm:row-start-1 {href ? 'tap-link hover:text-accent-text' : ''}"
						title={headTitle}>{headTitle}</svelte:element
					>
				</span>
				<span class="flex shrink-0 items-center gap-2 max-sm:col-start-2 max-sm:row-start-2 max-sm:min-w-0">
					{#if showStats && data}
						<span class="t-code-sm text-fg-subtle">
							<span class="text-success">+{data.additions}</span>
							<span class="text-danger">−{data.deletions}</span>
							<span class="text-fg-disabled">·</span>
							{data.changedFiles} file{data.changedFiles !== 1 ? 's' : ''}{#if count > 1}<span
									class="text-fg-disabled"> · </span
								>{count} commits{/if}
						</span>
					{/if}
					{#if href}
						<ChevronRightOutline class="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden="true" />
					{/if}
				</span>
			</span>
		{/if}
	{:else}
		{@const inner = `${count} commit${count !== 1 ? 's' : ''} ${verbText}`}
		<!-- ⭐ WITH `href`, THE WHOLE ROW IS THE TAP TARGET, NOT THE FIRST FOUR
		     WORDS. `.tap-zone` / `.tap-link` is the product's pattern for
		     exactly this (`app.css`): the anchor's `::after` covers the span, so
		     the count, the diffstat and the faces are one destination instead
		     of a link with two unclickable neighbours — which the design rules
		     call a broken affordance. Nothing changes for a caller that passes
		     no `href`; the span stays a span. -->
		{#if !listOnly}
		<span class="inline-flex flex-wrap items-center gap-2 {href ? 'tap-zone' : ''} {className}">
			<svelte:element
				this={href ? 'a' : 'span'}
				{href}
				aria-label={href ? (hrefLabel ? `${inner}. ${hrefLabel}` : undefined) : undefined}
				class="t-ui-sm inline-flex items-center gap-1.5 text-fg-muted {href
					? 'tap-link hover:text-accent-text'
					: ''}"
			>
				<span class="h-1.5 w-1.5 shrink-0 rounded-full {dotClass}"></span>
				<!-- ⭐ THE UNDO GLYPH FOR "reverted" (AD round 6, nits, History):
				     the branch icon is this file's own generic "commit range"
				     mark; a reverted range is specifically a rollback, the same
				     fact `UndoOutline` already names everywhere else in the
				     product (the row's own act, the strip's rollback marker). -->
				{#if effectiveDirection === 'rollback'}
					<UndoOutline class="h-3 w-3 shrink-0 text-fg-subtle" />
				{:else}
					<CodeBranchSolid class="h-3 w-3 shrink-0 text-fg-subtle" />
				{/if}
				{inner}
			</svelte:element>

			{#if showStats && data}
				<span class="t-code-sm text-fg-subtle">
					<span class="text-success">+{data.additions}</span>
					<span class="text-danger">−{data.deletions}</span>
					<!-- The dot-list's own dot ink (fg-disabled), so it never reads
					     brighter than the separators around it (LOGOPEN r11). -->
					<span class="text-fg-disabled">·</span>
					{data.changedFiles} file{data.changedFiles !== 1 ? 's' : ''}
				</span>
			{/if}

			{#if showAvatars && contributors.length > 0}
				<span class="flex items-center -space-x-1.5">
					{#each contributors.slice(0, 4) as c (c.author || c.sha)}
						<span class="rounded-full ring-2 ring-surface" title={c.author}><Avatar name={c.author || 'unknown'} src={c.avatarUrl ?? null} size={20} /></span>
					{/each}
					{#if contributors.length > 4}
						<span
							class="t-meta flex h-5 w-5 items-center justify-center rounded-full bg-subtle text-fg-subtle ring-2 ring-surface"
						>
							+{contributors.length - 4}
						</span>
					{/if}
				</span>
			{/if}

			{#if href}
				<!-- The product's "there is more, through here" mark — the same
				     chevron `Show N ready resources ›` uses one card over. It sits
				     inside the tap zone, so it takes the click without becoming a
				     second tab stop. -->
				<ChevronRightOutline
					class="h-3 w-3 shrink-0 text-fg-subtle"
					aria-hidden="true"
				/>
			{/if}
		</span>
		{/if}
		{#if showMessages && commits.length >= Math.max(1, messagesMin)}
			<!-- ⭐ NEWEST FIRST (AD round 8, item 2): "the range must be only
			     the commits between c3a9f22 and 62d1c05, newest first." The
			     underlying `commits` array itself stays oldest→newest — the
			     range's own HEAD must stay its last element (`respondGithub`'s
			     contract, `github-data.test.ts`'s own assertion, and
			     `headCommitTitle`'s "last item" rule both read it that way) —
			     this list is the ONE caller (`showMessages`, History's own
			     expanded panel) that shows the array to a reader as a scan
			     list, where the build just deployed belongs at the top, not
			     buried under however many commits came before it. Reversed
			     only for DISPLAY, here, not the data. -->
			<ul class="{listOnly ? '' : 'mt-1.5 '}space-y-1">
				{#each visibleRows as c (c.sha)}
					<li class="t-meta flex {rowAvatars ? 'items-center' : 'items-baseline'} gap-2">
						<a
							href={c.url}
							target="_blank"
							rel="noopener noreferrer"
							class="t-code-sm shrink-0 text-accent-text hover:underline"
							>{(c.sha ?? '').slice(0, 7)}</a
						>
						<span class="min-w-0 flex-1 truncate text-fg-muted"
							>{formatCommitMessage(c.message)}</span
						>
						{#if c.author}
							{#if rowAvatars}
								<span class="flex shrink-0 items-center gap-1.5 text-fg-subtle" title={c.author}>
									<Avatar name={c.author} src={c.avatarUrl ?? null} size={16} />
									<span class="hidden @sm:inline">{c.author}</span>
								</span>
							{:else}
								<span class="shrink-0 text-fg-subtle">{c.author}</span>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
			{#if messageLimit > 0 && commits.length > messageLimit}
				<button
					type="button"
					class="btn btn-secondary btn-xs mt-2"
					aria-expanded={showAllRows}
					onclick={() => (showAllRows = !showAllRows)}
				>
					{showAllRows ? 'Show fewer' : `${commits.length - messageLimit} more`}
				</button>
			{/if}
		{/if}
	{/if}
{/if}
