<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE BUILDS WAITING ON ONE PROMOTION EDGE — the body of a Direction B
	 * task.
	 *
	 * A task says "staging is 2 behind". This says WHAT the two are, because
	 * a person deciding whether to promote is deciding about the changes, not
	 * about the number. `DESIGN.md`: *"Commits between deployments should be
	 * visible (what actually changed)."*
	 *
	 * ── THE FORM: a queue hung on the gap's own rail ────────────────────
	 * These builds ARE what the state column's hop counts. The hop draws that
	 * gap as a dashed vertical rail labelled `N waiting`; this draws the same
	 * rail with the builds themselves on it, so the two halves of the page
	 * describe one object in one vocabulary — the right says how many, the
	 * left says which. One hairline, no new colour value.
	 *
	 * Each row is a three-column LEDGER — `sha · what changed · ready since` —
	 * with the ages right-aligned and tabular, so the repeated age reads as
	 * an aligned column under a head that names it ONCE, instead of three
	 * ragged lines each re-printing the word "released". The message column
	 * is empty when GitHub is not connected: it is a column that exists and
	 * has no data, which is the honest shape of that state, and the panel's
	 * own `Connect GitHub` prompt is the one place that explains why.
	 *
	 * ── LINKS: none, deliberately ───────────────────────────────────────
	 * Each sha used to link to `/versions/<revision>`. That page answers
	 * "where is this commit across every app" — a fleet-wide question, and a
	 * non-sequitur from "four builds are waiting to reach prod". Nothing in
	 * this product answers "what is in this build" when GitHub is not
	 * connected, so rather than navigate somewhere that answers a different
	 * question, the list is EVIDENCE and the task's targets are its buttons.
	 * The list is therefore EVIDENCE, and it sits behind the one control in
	 * the block — see the disclosure note below.
	 *
	 * ── ⭐ IT IS A DISCLOSURE NOW, AND THE SUMMARY IS THE FACT (2026-08-30) ─
	 *
	 * > *"does a reader deciding whether to approve a deploy need three build
	 * > ids and their ages in the card, or only how many are waiting and since
	 * > when? … the card should read in ONE GLANCE, not five."*
	 *
	 * Measured on the live cluster's `hello-world-app`, the open ledger spent
	 * EIGHT of a task row's nineteen text elements: a `ready since` column
	 * head, three shas, three ages, and a `+16 more` control. What those eight
	 * elements said was `0afab6f 1d / c1ecfe5 1d / 45d2662 1d`.
	 *
	 * Apply the file's own test — would the reader lose a FACT, or only a
	 * restatement?
	 *
	 *   · THE COUNT and THE AGE are facts, and neither was legible: the count
	 *     had to be reconstructed as `3 + 16` from a control's label, and the
	 *     age was printed three times under a head that named it once.
	 *   · THE THREE SHAS ARE NOT A FACT A DECIDER USES. A 7-hex sha is an
	 *     identifier with no ordering, no size and no subject. **And on the
	 *     shipped state of this product GitHub is not connected**, so the
	 *     message column — the entire reason a sha is worth printing — is
	 *     empty. Three opaque tokens and three identical `1d`s is the
	 *     densest, least decidable eighth of the card.
	 *   · CONNECTED, the messages ARE worth reading — but reading three of
	 *     nineteen commit subjects is not how "should PROD take a newer
	 *     build" gets decided either. It is evidence you open, not a fact you
	 *     glance at.
	 *
	 * So the ledger keeps every row it had and moves behind ONE control whose
	 * label is the fact it replaced: `19 versions ready · oldest 1d ago`. One
	 * text element instead of eight, the two facts stated rather than
	 * reconstructed, and the evidence one click away instead of gone.
	 *
	 * `+N more` IS DELETED WITH IT. Two nested disclosures on one queue —
	 * open the block, then open the tail — is a control whose only job was to
	 * undo a truncation that no longer happens. Expanded means expanded.
	 *
	 * ⛔ THE COUNT IS WORDED `ready`, NOT `waiting`. The state column's hop
	 * prints `N versions waiting to move` for `rank(down) − rank(up)` — the
	 * builds between two environments — and this list is
	 * `promotionCandidates`, the builds THIS environment could take. On the
	 * live cluster those are 5 and 19. Two different true numbers 340px apart
	 * must not share a verb.
	 *
	 * ── THE COMMITS REQUEST ─────────────────────────────────────────────
	 * ONE request per TASK, not per build: the range is
	 * `current → newest candidate`, and each waiting build's message is the
	 * commit in that range whose sha it points at. When GitHub is not
	 * connected the request is never made and the message column stays
	 * empty — the observable, never a placeholder sentence. Silence about a
	 * cause beats a confident wrong one.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import {
		fetchCommits,
		commitsQueryKey,
		formatCommitMessage,
		FetchCommitsError
	} from '$lib/api/github';
	import { formatTimeAgoCompact } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { ChevronRightOutline } from 'flowbite-svelte-icons';

	type WaitingBuild = {
		version: string;
		revision: string | null;
		createdMs: number;
	};

	let {
		namespace,
		name,
		cluster,
		base = null,
		head = null,
		builds,
		limit = 3,
		commitsAvailable = false
	}: {
		namespace: string;
		name: string;
		cluster?: string;
		/** Revision the environment is CURRENTLY on — the range's base. */
		base?: string | null;
		/** Revision of the newest waiting build — the range's head. */
		head?: string | null;
		/** Newest first. The FULL queue — the disclosure shows all of it. */
		builds: WaitingBuild[];
		/**
		 * ⛔ VESTIGIAL. The queue is either summarised or shown whole; there is
		 * no middle truncation any more. Kept so the prop is not a breaking
		 * change for a caller that still passes it.
		 */
		limit?: number;
		commitsAvailable?: boolean;
	} = $props();

	let open = $state(false);

	const anyAge = $derived(builds.some((b) => b.createdMs > 0));

	/**
	 * THE SUMMARY — the two facts the ledger was being read for, stated.
	 *
	 * `oldest` is the LAST entry's age, because the queue is newest-first: the
	 * oldest waiting build is how long this edge has been backed up, which is
	 * the number a person weighs against "is it worth a deploy". The newest
	 * build's own age is already on the primary button's version.
	 */
	const oldestMs = $derived.by<number | null>(() => {
		let best: number | null = null;
		for (const b of builds) {
			if (!(b.createdMs > 0)) continue;
			if (best === null || b.createdMs < best) best = b.createdMs;
		}
		return best;
	});
	const summary = $derived.by<string>(() => {
		const n = builds.length;
		const count = `${n} version${n === 1 ? '' : 's'} ready`;
		if (oldestMs === null) return count;
		const age = formatTimeAgoCompact(new Date(oldestMs).toISOString(), $now);
		return n === 1 ? `${count} · ${age} ago` : `${count} · oldest ${age} ago`;
	});

	// ONLY ONCE THE LEDGER IS OPEN. The messages are the only thing this
	// request feeds and nothing renders them while the block is a one-line
	// summary, so a closed task costs no network at all — on `edge-mesh` that
	// is one saved request per task on every page load.
	const enabled = $derived(
		open && commitsAvailable && !!namespace && !!name && !!base && !!head && base !== head
	);

	// Same discipline as `CommitSummary`: a commit range is immutable and an
	// auth failure is not transient, so this is neither polled nor retried.
	const query = createQuery(() => ({
		queryKey: commitsQueryKey(namespace, name, base ?? '', head ?? '', cluster),
		queryFn: () => fetchCommits(namespace, name, base!, head!, cluster),
		enabled,
		staleTime: 5 * 60_000,
		refetchInterval: false as const,
		retry: (failureCount: number, error: unknown) => {
			if (error instanceof FetchCommitsError) return false;
			return failureCount < 1;
		}
	}));

	function messageFor(b: WaitingBuild): string | null {
		const commits = query.data?.commits ?? [];
		if (commits.length === 0 || !b.revision) return null;
		const rev = b.revision.toLowerCase();
		for (const c of commits) {
			const sha = (c.sha ?? '').toLowerCase();
			if (!sha) continue;
			if (sha.startsWith(rev) || rev.startsWith(sha)) return formatCommitMessage(c.message);
		}
		return null;
	}

	/**
	 * Does the ledger have a middle column with anything in it? When GitHub is
	 * connected the message column takes the slack, so the ages keep the
	 * track's right edge and long messages get the room. When it is NOT
	 * connected there is nothing to take the slack, and a full-width ledger
	 * strands the age column ~600px from the sha it belongs to on a desktop
	 * task. So the ledger shrink-wraps instead: as wide as its content, no
	 * wider.
	 */
	const anyMessage = $derived((query.data?.commits ?? []).length > 0);

	function ageOf(b: WaitingBuild): string | null {
		if (!(b.createdMs > 0)) return null;
		return formatTimeAgoCompact(new Date(b.createdMs).toISOString(), $now);
	}
</script>

<div class="wb min-w-0 {anyMessage && open ? '' : 'wb--nomsg'}">
	<!-- THE ONE CONTROL, AND ITS LABEL IS THE FACT. Closed it is the whole
	     block; open it is the block's head. A chevron and not a `+N more`:
	     this opens a thing that is there, it does not lengthen a list. -->
	<button
		type="button"
		class="wb-toggle t-micro flex min-w-0 items-center gap-1 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<ChevronRightOutline
			class="h-3 w-3 shrink-0 transition-transform {open ? 'rotate-90' : ''}"
			aria-hidden="true"
		/>
		<span class="truncate">{summary}</span>
	</button>
	{#if open}
	{#if anyAge}
		<!-- The column head. It carries the word ONCE so every row below can
		     be a bare, aligned, tabular age.

		     `t-micro`, lower case, NOT the `t-label` head role. `t-label` is
		     what the panel's own `NEEDS A DECISION` is set in, and a column
		     head inside a task rendered at the same weight competes with the
		     panel it sits in. This is a unit, not a section. -->
		<p class="wb-row wb-head" aria-hidden="true">
			<!-- `released` on its own labelled a column of ages and left the
			     reader to work out released WHEN and released FROM WHAT.
			     `ready since` says what the number under it measures. -->
			<span class="wb-age t-micro text-gray-500 dark:text-gray-400">ready since</span>
		</p>
	{/if}
	<ul class="wb-list">
		{#each builds as b (b.version)}
			{@const msg = messageFor(b)}
			{@const age = ageOf(b)}
			<li class="wb-row">
				<span class="wb-sha t-code-sm text-gray-700 dark:text-gray-300">{b.version}</span>
				<span class="wb-msg t-micro truncate text-gray-500 dark:text-gray-400">{msg ?? ''}</span>
				{#if age}
					<span class="wb-age t-code-sm tabular-nums text-gray-500 dark:text-gray-400">{age}</span>
				{/if}
			</li>
		{/each}
	</ul>
	{/if}
</div>

<style>
	/* THE RAIL — the same geometry as the state column's hop
	   (`.ab-fleethop` / `StageChain`): a 1px dashed line 2px in, with the
	   content starting 13px from the left. The builds hang on the gap they
	   are waiting in. */
	.wb-list {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	/* THE DASHED GAP RAIL IS ONE VALUE IN THE PRODUCT, NOT TWO (2026-08-27).
	   This comment already claimed "the same geometry as the state column's
	   hop (`.ab-fleethop` / `StageChain`)" and then drew it a step lighter —
	   `gray-300` / `gray-600` here against `gray-400` / `gray-500` there. One
	   object, one meaning ("builds are waiting on this edge"), two colour
	   values, 340px apart on the same screen. Measured on
	   `/apps/payments-core`: `#d1d5dc` light and `#4a5565` dark appeared on
	   the page for this rule and for nothing else, so unifying removes one
	   value per theme and costs none. */
	.wb-list::before {
		content: '';
		position: absolute;
		inset-block: 2px;
		left: 2px;
		border-left: 1px dashed var(--color-gray-400);
	}
	:global(.dark) .wb-list::before {
		border-left-color: var(--color-gray-500);
	}

	/* THE LEDGER — sha, what changed, released. The middle column takes the
	   slack so the age column keeps one right edge whether or not GitHub is
	   connected. */
	.wb-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: baseline;
		column-gap: 12px;
		padding-left: 13px;
		min-width: 0;
	}
	/* No message column with anything in it → the ledger shrink-wraps to its
	   own content instead of stretching the age column across a whole desktop
	   track.

	   It shrink-wraps on the CONTAINER, not by collapsing each row's tracks.
	   Every row is its own grid, so `justify-content: start` per row sizes
	   each row to ITS OWN age and the ages come out LEFT-aligned with a ragged
	   right edge — `41m`, `5h`, `1d` all starting at the same x. Sizing the
	   container to `max-content` instead keeps every row at one width, so the
	   `1fr` middle still absorbs each row's slack and the age column keeps the
	   single right edge the head is aligned to. */
	.wb--nomsg {
		width: max-content;
		max-width: 100%;
	}
	.wb-head {
		margin-top: 8px;
		margin-bottom: 4px;
	}
	.wb-sha {
		grid-column: 1;
	}
	.wb-msg {
		grid-column: 2;
	}
	/* The age lives in column 3 in every row INCLUDING the head, so the head
	   sits over its own column rather than over the whole block, and the
	   whole ledger keeps one right edge. */
	.wb-age {
		grid-column: 3;
		text-align: right;
		white-space: nowrap;
	}

	/* THE DISCLOSURE. It is the block when closed and the block's head when
	   open, so it sits at the ledger's own left edge — NOT at the rail's 13px
	   indent, because it is not one of the things hanging on the rail. */
	.wb-toggle {
		text-align: left;
	}
</style>
