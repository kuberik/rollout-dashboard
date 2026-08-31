<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⛔ THE FASTEST SURFACE IN THE PRODUCT WAS THE ONE THAT TOLD YOU LEAST.
	 * (2026-08-30)
	 *
	 * > *"Command palette works well; results carry version + env and age but
	 * > NO HEALTH, LAG OR PIN STATE, so the fastest navigation surface carries
	 * > no triage signal. '36 results' shows before you type anything."*
	 *
	 * Every fact it lacked was already computed and already rendered elsewhere:
	 * `buildRolloutCards` + `cardVerdict` are what `/` draws its cards from, and
	 * `env-rank.ts` is the product's one answer to `N behind`. So this file
	 * DERIVES NOTHING OF ITS OWN — it reads the same objects, which is also the
	 * only way a palette row and the page it opens cannot disagree.
	 *
	 * ── WHAT A ROLLOUT ROW ANSWERS NOW ──────────────────────────────────────
	 *
	 *   [status disc] checkout-api                          [PROD]  1h
	 *                 checkout-api-prod-us-east-2  [stuck][19 behind|4.42.0-42]
	 *
	 * · the LEADING DISC is the bake state — `getStatusCircleClass` +
	 *   `BakeStatusIcon`, the product's status atom, the same one `/` puts on
	 *   its cards. It replaced a KIND icon that was identical on every row of a
	 *   group whose header already names the kind: a mark repeated on every row
	 *   under a heading that states it is a mark that cannot mark anything.
	 * · the joined `[verdict][build]` chip is `/`'s own row unit, and `verdict`
	 *   is `cardVerdict`'s — the RANK word, always. (2026-08-31: the precedence
	 *   `rolled back` > `pinned` > rank was deleting the number, so the state
	 *   moved into the leading disc exactly as it did on `/` and `/rollouts`.
	 *   One act, one spelling, three surfaces.) The sha stops being a loose
	 *   mono span floating beside the name with nothing to say about it.
	 * · `stuck` keeps its alarm chip, which was already the one thing the
	 *   palette got right.
	 *
	 * ⛔ AND THE `Ready` DOT IS DELETED. It was `getRolloutStatus` — the
	 * Kubernetes `Ready` CONDITION, which no other surface in this product
	 * renders. Measured under `MOCK_API=1`, ten consecutive rows printed the
	 * same yellow `Unknown` dot, because none of those rollouts publishes the
	 * condition at all. A mark that is identical on every row AND is not the
	 * fact the reader wants is worse than no mark: it occupies the slot the
	 * real health signal needed.
	 *
	 * ── THE SECOND HALF: LINE 1 IS IDENTITY, LINE 2 IS STATE ────────────────
	 *
	 * The state chips are `ms-auto` on the second line, so they align in a
	 * COLUMN down the result list while the namespace truncates into whatever
	 * is left. A palette row is scanned vertically; chips that start at a
	 * different x on every row cannot be scanned at all. It is also what keeps
	 * 390 honest — at full-bleed width the namespace gives up characters and
	 * the marks never do.
	 */
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import type { Rollout, Environment } from '../types';
	import { formatTimeAgoCompact, getDisplayVersion, formatDate } from '$lib/utils';
	import Chip from '$lib/components/Chip.svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import { getStatusCircleClass, bakeWord, bakeTitle } from '$lib/bake-status';
	import { buildRolloutCards, cardVerdict, cardStateMark } from '$lib/rollout-cards';
	import type { RolloutCard } from '$lib/rollout-cards';
	import { rankLabel, rankRole, rankTitle, rankBehindBy } from '$lib/view-models/env-rank';
	import {
		SearchOutline,
		GridOutline,
		RocketOutline,
		LayersSolid,
		ClockOutline,
		FolderOutline
	} from 'flowbite-svelte-icons';
	import {
		getEnvironmentThemeStyle,
		getRolloutEnvironmentTheme,
		shortEnvLabel
	} from '$lib/environment-theme';
	import { rolloutMatchesEnvironment, rolloutPath } from '$lib/source-dashboard';
	import { now } from '$lib/stores/time';
	import { inertSiblings, trapFocus, modalFocusReturn } from '$lib/a11y.svelte';

	type ResultKind = 'rollout' | 'app' | 'env' | 'namespace' | 'action';

	let {
		open = $bindable(false),
		scope = $bindable(null),
		rollouts,
		environments,
		localClusterName = '',
		currentNamespace,
		currentName,
		loading = false
	}: {
		open: boolean;
		scope?: ResultKind | null;
		rollouts: Rollout[];
		environments: Environment[];
		localClusterName?: string;
		currentNamespace?: string;
		currentName?: string;
		loading?: boolean;
	} = $props();

	/**
	 * ⭐ THE ONE OVERLAY IN THE PRODUCT THAT IS NOT A NATIVE `<dialog>`.
	 *
	 * It always had `role="dialog"` and `aria-modal="true"` — and those are a
	 * PROMISE, not a mechanism. Measured on 2026-08-30 by opening the palette
	 * from the navbar and pressing Tab: the fifteenth press was still inside,
	 * the sixteenth landed on the sidebar's `Home` link, underneath the
	 * backdrop, with the palette still open on top of it. `aria-modal` had told
	 * a screen reader to ignore a page that Tab could still walk, and closing
	 * the palette left focus on `<body>` rather than on the control that opened
	 * it. The three flowbite `Modal`s never had this bug because a native
	 * `<dialog>` opened with `showModal()` does all three for free.
	 */
	modalFocusReturn(() => open);

	let searchInput = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLDivElement | null>(null);
	let query = $state('');
	let selectedIndex = $state(0);
	type Result = {
		kind: ResultKind;
		key: string;
		// Canonical, searchable identifier — the resource name for rollouts.
		title: string;
		// Optional human-friendly OCI title, shown muted alongside the name.
		pretty?: string;
		subtitle?: string;
		href: string;
		// Extra surface-area for visual cues
		envTheme?: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		/** The bake state, for the leading status disc. Rollout rows only. */
		bakeStatus?: string;
		version?: string;
		timestamp?: string;
		stuck?: boolean;
		isCurrent?: boolean;
		/**
		 * THE ROW'S ONE VERDICT WORD, from `cardVerdict` — `rolled back`,
		 * `pinned`, or the rank (`19 behind` / `newest` / `unreleased` /
		 * `unknown`). Its `title` carries everything the word displaced.
		 */
		verdict?: { label: string; title: string; role: 'newest' | 'rank' | 'diverged' | 'unranked' };
		/** `rolled back` / `pinned`, drawn in the leading disc — see `/`. */
		state?: 'rolled-back' | 'pinned' | null;
		stateWord?: string;
		stateTitle?: string;
		/**
		 * How many things under this result need a person — a rollout that has
		 * FAILED or is STUCK. 0 on everything settled, and nothing renders for
		 * a 0: a count of the norm is not a mark.
		 */
		needsYou?: number;
		/** Worst-first ordering key for the default screen. Higher is worse. */
		severity?: number;
		// For `app` rows: per-env mini-strip data (env theme + bake status)
		envCells?: Array<{
			envName: string;
			theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
			bakeStatus: string;
			version: string | null;
		}>;
	};

	/**
	 * ONE DERIVATION FOR THE WHOLE PALETTE, AND IT IS `/`'S OWN.
	 *
	 * `buildRolloutCards` already resolves the theme, the version, the stuck
	 * detector, the pin, the rollback and — through `env-rank.ts` — the ONE
	 * `N behind` the product publishes. Re-deriving any of that here is how the
	 * three pages that each invented a `−N` came to print three numbers for one
	 * rollout.
	 */
	const cards = $derived.by<RolloutCard[]>(() => buildRolloutCards(rollouts, environments, $now));

	/** A rollout that will not resolve without a person: failed, or stuck. */
	function cardNeedsYou(c: RolloutCard): boolean {
		return c.statusKey === 'failed' || !!c.stuck;
	}
	/** Worst first. Failure outranks a stall; a stall outranks a lag. */
	function cardSeverity(c: RolloutCard): number {
		if (c.statusKey === 'failed') return 3;
		if (c.stuck) return 2;
		if (rankBehindBy(c.rank) > 0) return 1;
		return 0;
	}

	// Build the index from all entity types. The palette is a single
	// haystack — we filter/sort once, then render with section headers.
	const allResults = $derived.by<Result[]>(() => {
		const out: Result[] = [];

		// 1. Rollouts
		for (const c of cards) {
			const r = c.rollout;
			// THE VERDICT WORD IS `/`'S, NOT A SECOND OPINION. `cardVerdict`
			// keeps the rank in the word and folds the state's sentence into
			// the title; the state itself rides the leading disc, same as `/`.
			const sentence = rankTitle(c.rank, c.envDisplay || c.name);
			const v = cardVerdict(c, rankLabel(c.rank), sentence);
			const mark = cardStateMark(c);
			out.push({
				kind: 'rollout',
				// Source cluster must be part of the key: the hub merges rollouts
				// from multiple clusters, so namespace/name alone is not unique
				// and would produce duplicate keyed-each keys (crashes the list).
				key: `rollout:${c.sourceCluster}|${c.ns}/${c.name}`,
				title: c.name,
				pretty: r.status?.title && r.status.title !== c.name ? r.status.title : undefined,
				subtitle: c.ns,
				href: rolloutPath(c.sourceCluster || localClusterName, c.ns, c.name),
				envTheme: c.theme,
				bakeStatus: c.bakeStatus,
				version: c.version ?? undefined,
				timestamp: c.timestamp ?? undefined,
				stuck: !!c.stuck,
				verdict: { label: v.label, title: v.title, role: rankRole(c.rank) },
				state: mark?.kind ?? null,
				stateWord: mark?.word ?? '',
				stateTitle: mark?.title ?? '',
				needsYou: cardNeedsYou(c) ? 1 : 0,
				severity: cardSeverity(c),
				isCurrent: c.name === currentName && c.ns === currentNamespace
			});
		}

		// 2. Apps (rollout name across envs)
		const appNames = new Set<string>();
		for (const env of environments) {
			const n = env.spec?.rolloutRef?.name;
			if (n) appNames.add(n);
		}
		for (const name of appNames) {
			const cells = environments.filter((e) => e.spec?.rolloutRef?.name === name);
			const envCells = cells
				.map((env) => {
					const envName = env.spec?.environment ?? '';
					const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
					const theme = r ? getRolloutEnvironmentTheme(r, env) : null;
					const latest = r?.status?.history?.[0];
					return {
						envName,
						theme,
						bakeStatus: latest?.bakeStatus ?? 'None',
						version: latest?.version ? getDisplayVersion(latest.version) : null
					};
				})
				.sort((a, b) => a.envName.localeCompare(b.envName));
			// THE APP'S OWN CARDS — the deepest lag and how many places need a
			// person, both read off the same objects `/apps` ranks with.
			const own = cards.filter((c) =>
				cells.some((e) => rolloutMatchesEnvironment(c.rollout, e))
			);
			const deepest = own.reduce((m, c) => Math.max(m, rankBehindBy(c.rank)), 0);
			const allNewest = own.length > 0 && own.every((c) => c.rank.kind === 'newest');
			out.push({
				kind: 'app',
				key: `app:${name}`,
				title: name,
				subtitle:
					envCells.length > 0 ? `${envCells.length} env${envCells.length === 1 ? '' : 's'}` : undefined,
				href: `/apps/${encodeURIComponent(name)}`,
				envCells,
				// `N behind` here is the FURTHEST an environment of this app has
				// fallen — the number `/apps` prints in its own gap column, not a
				// new one. When every environment is on head the word is `newest`;
				// when neither holds there is no honest single answer and the row
				// prints none rather than a `0`.
				verdict: allNewest
					? {
							label: 'newest',
							title: `Every environment of ${name} is on the newest version it has`,
							role: 'newest'
						}
					: deepest > 0
						? {
								label: `${deepest} behind`,
								title: `The furthest-behind environment of ${name} can still take ${deepest} newer version${deepest === 1 ? '' : 's'}`,
								role: 'rank'
							}
						: undefined,
				needsYou: own.filter(cardNeedsYou).length,
				severity: own.reduce((m, c) => Math.max(m, cardSeverity(c)), 0)
			});
		}

		// 3. Environments
		const envNames = new Set<string>();
		for (const env of environments) {
			const n = env.spec?.environment;
			if (n) envNames.add(n);
		}
		for (const name of envNames) {
			const members = environments.filter((e) => e.spec?.environment === name);
			const refRollout = (() => {
				for (const e of members) {
					const r = rollouts.find((r) => rolloutMatchesEnvironment(r, e));
					if (r) return r;
				}
				return null;
			})();
			const theme = refRollout ? getRolloutEnvironmentTheme(refRollout) : null;
			const own = cards.filter((c) => members.some((e) => rolloutMatchesEnvironment(c.rollout, e)));
			out.push({
				kind: 'env',
				key: `env:${name}`,
				title: theme?.label || name,
				subtitle: `${members.length} app${members.length === 1 ? '' : 's'}`,
				href: `/envs/${encodeURIComponent(name)}`,
				envTheme: theme,
				needsYou: own.filter(cardNeedsYou).length,
				severity: own.reduce((m, c) => Math.max(m, cardSeverity(c)), 0)
			});
		}

		// 4. Namespaces
		const namespaces = new Set<string>();
		for (const c of cards) {
			if (c.ns) namespaces.add(c.ns);
		}
		for (const ns of namespaces) {
			const own = cards.filter((c) => c.ns === ns);
			out.push({
				kind: 'namespace',
				key: `ns:${ns}`,
				title: ns,
				subtitle: `${own.length} rollout${own.length === 1 ? '' : 's'}`,
				href: `/namespaces/${encodeURIComponent(ns)}`,
				needsYou: own.filter(cardNeedsYou).length,
				severity: own.reduce((m, c) => Math.max(m, cardSeverity(c)), 0)
			});
		}

		// 5. Actions (top-level pages)
		const actions: { title: string; href: string; subtitle?: string }[] = [
			{ title: 'Fleet overview', subtitle: 'Everything at a glance', href: '/' },
			{ title: 'Rollouts', subtitle: 'Full inventory list', href: '/rollouts' },
			{ title: 'Apps', subtitle: 'Apps across environments', href: '/apps' },
			{ title: 'Environments', subtitle: 'Cross-env matrix', href: '/environments' },
			{ title: 'Activity', subtitle: 'Recent deployments', href: '/activity' }
		];
		for (const a of actions) {
			out.push({
				kind: 'action',
				key: `action:${a.href}`,
				title: a.title,
				subtitle: a.subtitle,
				href: a.href
			});
		}

		return out;
	});

	/**
	 * ⛔ WHAT AN EMPTY QUERY SHOWS, AND WHY IT IS NOT A COUNT. (2026-08-30)
	 *
	 * > *"'36 results' shows before you type anything."*
	 *
	 * It did, in the footer, while the BODY showed a four-tile category picker
	 * — so the one number on the screen counted a set nobody had asked for and
	 * nothing on screen was showing. A count of everything is not an answer to
	 * any question a person opens a palette to ask.
	 *
	 * The handful that actually need a person is. `Needs you` is the same
	 * predicate `/`'s own first card uses — failed, or stuck — read off the
	 * same cards, sorted worst-first, and it sits ABOVE the picker with the
	 * cursor already on its first row. So ⌘K + Enter goes straight to the worst
	 * thing on the cluster.
	 *
	 * ⛔ AND IT DRAWS NOTHING WHEN NOTHING IS WRONG. A `Needs you — 0` header
	 * is a slot spent on absence, which is the same object this pass removed
	 * from `/apps/[name]`'s state card; on a healthy cluster the default screen
	 * is exactly the picker it always was. Capped at 6 — past that this stops
	 * being a triage list and becomes the list you already have at `/`, and the
	 * header prints the true total so the cap can never hide one.
	 */
	const ATTENTION_CAP = 6;
	const attention = $derived.by<Result[]>(() =>
		allResults
			.filter((r) => r.kind === 'rollout' && (r.needsYou ?? 0) > 0)
			.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0) || a.title.localeCompare(b.title))
	);
	const attentionShown = $derived(attention.slice(0, ATTENTION_CAP));

	// Scoring: substring on title is best, then on subtitle/version/env, etc.
	// Tied scores fall back to entity-kind priority so users see rollouts first.
	const KIND_PRIORITY: Record<ResultKind, number> = {
		rollout: 4,
		app: 3,
		env: 2,
		namespace: 1,
		action: 0
	};
	function score(r: Result, q: string): number {
		if (!q) return KIND_PRIORITY[r.kind];
		const lower = q.toLowerCase();
		const hay = [
			r.title,
			r.pretty ?? '',
			r.subtitle ?? '',
			r.version ?? '',
			r.envTheme?.label ?? '',
			r.envTheme?.environmentName ?? '',
			// THE STATE IS SEARCHABLE NOW. `stuck`, `pinned`, `rolled back`,
			// `19 behind`, `checking` — the words the row already prints. A
			// reader who can see a word and cannot type it is being asked to
			// remember which page lists it.
			r.verdict?.label ?? '',
			r.stuck ? 'stuck' : '',
			r.bakeStatus ? bakeWord(r.bakeStatus) : ''
		]
			.join(' ')
			.toLowerCase();
		if (!hay.includes(lower)) return -1;
		let s = 0;
		const titleLower = r.title.toLowerCase();
		if (titleLower === lower) s += 100;
		else if (titleLower.startsWith(lower)) s += 60;
		else if (titleLower.includes(lower)) s += 30;
		if ((r.pretty ?? '').toLowerCase().includes(lower)) s += 12;
		if ((r.subtitle ?? '').toLowerCase().includes(lower)) s += 10;
		if ((r.version ?? '').toLowerCase().includes(lower)) s += 8;
		if ((r.envTheme?.label ?? '').toLowerCase().includes(lower)) s += 8;
		s += KIND_PRIORITY[r.kind] * 0.5;
		return s;
	}

	const filtered = $derived.by(() => {
		const q = query.trim();
		const scoped = scope ? allResults.filter((r) => r.kind === scope) : allResults;
		const scored = scoped.map((r) => ({ r, s: score(r, q) })).filter((x) => x.s >= 0);
		scored.sort((a, b) => {
			if (b.s !== a.s) return b.s - a.s;
			// WORST FIRST WITHIN A TIE. Two rollouts of one app score the same
			// on the app's name, and the one that is failing is the one being
			// looked for.
			const sev = (b.r.severity ?? 0) - (a.r.severity ?? 0);
			if (sev !== 0) return sev;
			return a.r.title.localeCompare(b.r.title);
		});
		return scored.slice(0, 200).map((x) => x.r);
	});

	// Group filtered results by kind for rendering. Keeps a flat index for kb nav.
	type Group = { kind: ResultKind; label: string; items: { result: Result; idx: number }[] };
	const KIND_LABEL: Record<ResultKind, string> = {
		rollout: 'Rollouts',
		app: 'Apps',
		env: 'Environments',
		namespace: 'Namespaces',
		action: 'Go to'
	};
	const KIND_SINGULAR: Record<ResultKind, string> = {
		rollout: 'rollout',
		app: 'app',
		env: 'environment',
		namespace: 'namespace',
		action: 'page'
	};
	const grouped = $derived.by<Group[]>(() => {
		const map = new Map<ResultKind, Group>();
		filtered.forEach((result, idx) => {
			let g = map.get(result.kind);
			if (!g) {
				g = { kind: result.kind, label: KIND_LABEL[result.kind], items: [] };
				map.set(result.kind, g);
			}
			g.items.push({ result, idx });
		});
		// Stable group order by kind priority
		return Array.from(map.values()).sort((a, b) => KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind]);
	});

	$effect(() => {
		if (!open) return;
		(async () => {
			query = '';
			await tick();
			selectedIndex = 0;
			const isTouch =
				typeof window !== 'undefined' &&
				(window.matchMedia?.('(pointer: coarse)').matches ?? false);
			if (!isTouch) searchInput?.focus();
			scrollSelectedIntoView();
		})();
	});

	function scrollSelectedIntoView() {
		requestAnimationFrame(() => {
			const el = listEl?.querySelector(`[data-idx="${selectedIndex}"]`);
			el?.scrollIntoView({ block: 'nearest' });
		});
	}

	function pick(r: Result) {
		open = false;
		goto(r.href);
	}

	function onInput(e: Event) {
		query = (e.currentTarget as HTMLInputElement).value;
		selectedIndex = 0;
	}

	/**
	 * THE DEFAULT SCREEN IS ONE FLAT INDEX SPACE: the attention rows first,
	 * then the four picker tiles. `Enter` opens a row or drills into a kind
	 * depending on which half the cursor is in — the reader never has to know
	 * there are two kinds of thing here, only that down-arrow and Enter work.
	 */
	const PICKER_KINDS: ResultKind[] = ['rollout', 'app', 'env', 'namespace'];
	const inPicker = $derived(!scope && !query);

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		const maxIdx = inPicker
			? attentionShown.length + PICKER_KINDS.length - 1
			: filtered.length - 1;
		if (e.key === 'Escape') {
			e.preventDefault();
			// First ESC clears the scope (back to picker); second ESC closes.
			if (scope) {
				scope = null;
				query = '';
				selectedIndex = 0;
			} else {
				open = false;
			}
		} else if (e.key === 'Backspace' && query === '' && scope) {
			e.preventDefault();
			scope = null;
			selectedIndex = 0;
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, maxIdx);
			scrollSelectedIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
			scrollSelectedIntoView();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (inPicker) {
				const r = attentionShown[selectedIndex];
				if (r) {
					pick(r);
					return;
				}
				const k = PICKER_KINDS[selectedIndex - attentionShown.length];
				if (k) {
					scope = k;
					selectedIndex = 0;
					searchInput?.focus();
				}
			} else {
				const r = filtered[selectedIndex];
				if (r) pick(r);
			}
		}
	}

	const KIND_ICON: Record<ResultKind, typeof GridOutline> = {
		rollout: GridOutline,
		app: RocketOutline,
		env: LayersSolid,
		namespace: FolderOutline,
		action: ClockOutline
	};
</script>

<svelte:window onkeydown={handleKeydown} />

{#snippet resultRow(r: Result, idx: number)}
	{@const isActive = idx === selectedIndex}
	{@const Icon = KIND_ICON[r.kind]}
	<!-- `blue-50/70`, NOT `blue-50`. MEASURED: the muted ink pair this
	     product spends everywhere (`gray-500` / `gray-400`) clears 4.5 on
	     white by 0.4 and NOTHING ELSE. A full-strength `blue-50` fill drops
	     the row's subtitle, its age and its rank chip to 4.44 — under the
	     floor, on the one row a reader is looking at. The alpha ladder,
	     canvas-resolved against the composited white: 1.0 = 4.44,
	     0.8 = 4.52, 0.7 = 4.56, 0.6 = 4.60. `/70` is the first step that
	     clears with room and keeps a visible cursor; the ACTIVE TITLE going
	     `blue-700` is the other half of the affordance and is untouched.
	     Dark is `blue-900/40` and never failed (0 of 0 rows). -->
	<button
		type="button"
		role="option"
		id={`cp-opt-${idx}`}
		aria-selected={isActive}
		data-idx={idx}
		aria-current={r.isCurrent ? 'page' : undefined}
		title={r.isCurrent ? 'Currently open' : undefined}
		class="group relative flex w-full items-start gap-3 overflow-hidden rounded-lg px-3 py-2 text-left transition-colors {isActive
			? 'bg-blue-50/70 dark:bg-blue-900/40'
			: 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}"
		onclick={() => pick(r)}
		onmouseenter={() => (selectedIndex = idx)}
	>
		{#if r.isCurrent}
			<span
				class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-blue-500 dark:bg-blue-400"
				aria-hidden="true"
			></span>
		{/if}
		<!-- THE LEADING SLOT. On a rollout row it is the STATUS ATOM — the same
		     tinted disc + glyph `/` puts on its cards — because the group header
		     above already says these are rollouts and a kind icon repeated down
		     the column marks only the norm. Every other kind keeps its glyph:
		     an app or a namespace has no single bake state, and inventing one
		     for it would be the "green tick beside PROD is 14 behind" lie. -->
		{#if r.kind === 'rollout'}
			<span
				class="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
					r.bakeStatus
				)}"
				title={r.stateTitle
					? `${bakeWord(r.bakeStatus)} — ${bakeTitle(r.bakeStatus)}. ${r.stateTitle}`
					: `${bakeWord(r.bakeStatus)} — ${bakeTitle(r.bakeStatus)}`}
			>
				<!-- `decorative`: the `sr-only` word is already printed right here. -->
				<BakeStatusIcon
					bakeStatus={r.bakeStatus}
					size="small"
					state={r.state ?? null}
					decorative
				/>
				<span class="sr-only"
					>{bakeWord(r.bakeStatus)}{r.stateWord && r.bakeStatus === 'Succeeded'
						? `, ${r.stateWord}`
						: ''}</span
				>
			</span>
		{:else}
			<span
				class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-700/60 dark:text-gray-400"
			>
				<Icon class="h-3.5 w-3.5" />
			</span>
		{/if}

		<div class="flex min-w-0 flex-1 flex-col gap-0.5">
			<!-- LINE 1 — IDENTITY. -->
			<div class="flex min-w-0 items-baseline gap-2">
				<span
					class="truncate text-sm font-medium {isActive
						? 'text-blue-700 dark:text-blue-200'
						: 'text-gray-900 dark:text-white'}">{r.title}</span
				>
				{#if r.kind !== 'rollout' && r.pretty}
					<span class="truncate text-xs text-gray-500 dark:text-gray-400">{r.pretty}</span>
				{/if}
				<span class="ms-auto flex shrink-0 items-center gap-1.5">
					{#if r.kind !== 'rollout' && (r.needsYou ?? 0) > 0}
						<!-- A COUNT ONLY WHERE IT IS NOT 1. An app, an environment
						     or a namespace is a SET, so "how many of these need a
						     person" is the fact; a rollout is one thing and says it
						     with its own disc and its own alarm chip instead. -->
						<Chip
							role="alarm"
							label="{r.needsYou} need{r.needsYou === 1 ? 's' : ''} you"
							wide
							title="{r.needsYou} rollout{r.needsYou === 1 ? '' : 's'} here failed or stopped moving"
						/>
					{/if}
					{#if r.kind !== 'rollout' && r.verdict}
						<Chip role={r.verdict.role} label={r.verdict.label} wide title={r.verdict.title} />
					{/if}
					{#if r.envTheme}
						<!-- DELIBERATELY NOT `wide` (2026-08-26). The full namespace is printed
						     on this same row, as the result's own subtitle -- `edge-mesh-prod-
						     us-east-1` under `edge-mesh` -- so the chip is a colour/tier cue and
						     not the identifier. This is the "repeated label whose full name is
						     adjacent" case, and the palette is a fixed-width overlay that cannot
						     grow to absorb 147px. -->
						<Chip role="env" theme={r.envTheme} label={shortEnvLabel(r.envTheme)} class="shrink-0" />
					{/if}
					{#if r.timestamp}
						<span
							class="hidden shrink-0 font-mono text-[10px] tabular-nums text-gray-500 dark:text-gray-400 sm:inline"
							title={formatDate(r.timestamp)}>{formatTimeAgoCompact(r.timestamp, $now)}</span
						>
					{/if}
				</span>
			</div>

			<!-- LINE 2 — STATE, right-aligned so it forms a column. -->
			{#if r.kind === 'app' && r.envCells && r.envCells.length > 0}
				<!-- Per-env mini-strip — just the themed env badges,
				     no status dot inside (the inner dot was reading
				     as part of the badge chrome rather than a status
				     cue). Tooltip still surfaces the deploy state. -->
				<div class="flex min-w-0 flex-wrap items-center gap-1.5">
					{#each r.envCells as ec (ec.envName)}
						<!-- DELIBERATELY NOT `wide` (2026-08-26). The strip is a COUNT AND A STATE,
						     not a list of names: its job is "this app is in 13 places and they are
						     all green". The row's identifier is the APP NAME above it, and the
						     place that prints every region whole is `/apps/<name>`, one keystroke
						     away, where the chips ARE `wide`. Widening here costs the one surface
						     whose entire value is scanning many results at once: measured at 1440,
						     13 chips at 72px wrap to 2 lines inside the 592px result row and to 4
						     lines at full width, halving how many results fit the 520px scroll
						     region. Full name is in `title` on every chip. -->
						<Chip
							role="env"
							theme={ec.theme}
							label={shortEnvLabel(ec.theme) || ec.envName}
							title={`${ec.envName} · ${ec.version ?? 'no deploy'} · ${bakeWord(ec.bakeStatus)}`}
						/>
					{/each}
				</div>
			{:else if r.kind === 'rollout'}
				<div class="flex min-w-0 items-center gap-2">
					{#if r.pretty}
						<span class="truncate text-xs text-gray-500 dark:text-gray-400"
							>{r.pretty} · {r.subtitle}</span
						>
					{:else if r.subtitle}
						<span class="truncate text-xs text-gray-500 dark:text-gray-400">{r.subtitle}</span>
					{/if}
					<span class="ms-auto flex shrink-0 items-center gap-1.5">
						{#if r.stuck}
							<Chip role="alarm" label="stuck" title="Stopped moving" />
						{/if}
						{#if r.verdict}
							<!-- ⛔ ONE CHIP, TWO HALVES — `/`'s own row unit. The rank
							     and the build it describes are ONE fact and used to sit
							     in two places on this row: a bare mono sha beside the
							     name, and nothing at all about the rank. `wide` is
							     REQUIRED, not preferred: `19 BEHIND` and `ROLLED BACK`
							     both exceed `.chip`'s 12ch cap at the uppercase
							     tracking, and a truncated label is not a word. -->
							<Chip
								role={r.verdict.role}
								label={r.verdict.label}
								value={r.version ?? null}
								wide
								title={r.verdict.title}
							/>
						{/if}
					</span>
				</div>
			{:else if r.subtitle}
				<span class="truncate text-xs text-gray-500 dark:text-gray-400">{r.subtitle}</span>
			{/if}
		</div>
	</button>
{/snippet}

{#if open}
	<div
		class="fixed inset-0 z-[100] flex items-start justify-center sm:pt-[12vh]"
		role="dialog"
		aria-modal="true"
		aria-label="Command palette"
		use:inertSiblings
		use:trapFocus
	>
		<button
			type="button"
			aria-label="Close"
			class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm backdrop-enter"
			onclick={() => (open = false)}
		></button>

		<div
			class="relative z-10 flex h-full w-full flex-col overflow-hidden bg-white palette-enter dark:bg-gray-800 sm:mx-4 sm:h-auto sm:max-w-2xl sm:rounded-xl sm:shadow-2xl sm:ring-1 sm:ring-gray-200 sm:dark:ring-gray-700"
		>
			<div
				class="flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
			>
				<SearchOutline class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
				{#if scope}
					{@const ScopeIcon = KIND_ICON[scope]}
					<span
						class="inline-flex shrink-0 items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700/60 dark:text-gray-200"
					>
						<ScopeIcon class="h-3 w-3" />
						<span>{KIND_LABEL[scope]}</span>
						<button
							type="button"
							onclick={() => {
								scope = null;
								selectedIndex = 0;
								searchInput?.focus();
							}}
							aria-label="Clear scope"
							class="-mr-0.5 ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-600/60 dark:hover:text-gray-200"
							>×</button
						>
					</span>
				{/if}
				<!-- Combobox semantics. Arrow keys move `selectedIndex` but focus never
				     leaves this input, so before `aria-activedescendant` a screen reader
				     was told NOTHING as the reader arrowed down a list of rollouts. -->
				<input
					bind:this={searchInput}
					value={query}
					oninput={onInput}
					type="text"
					role="combobox"
					aria-label={scope
						? `Search ${KIND_LABEL[scope].toLowerCase()}`
						: 'Search rollouts, apps, environments and namespaces'}
					aria-expanded="true"
					aria-controls="command-palette-results"
					aria-autocomplete="list"
					aria-activedescendant={`cp-opt-${selectedIndex}`}
					placeholder={scope
						? `Search ${KIND_LABEL[scope].toLowerCase()}…`
						: 'Search rollouts, apps, environments, namespaces…'}
					autocomplete="off"
					spellcheck="false"
					class="flex-1 border-0 bg-transparent p-0 text-base text-gray-900 placeholder-gray-500 outline-none focus:outline-none focus:ring-0 sm:text-sm dark:text-white"
				/>
				<kbd
					class="hidden shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400 sm:inline-block"
					>ESC</kbd
				>
				<button
					type="button"
					aria-label="Close"
					onclick={() => (open = false)}
					class="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-gray-200 sm:hidden"
				>
					<span class="text-xl leading-none" aria-hidden="true">×</span>
				</button>
			</div>

			<div
				bind:this={listEl}
				id="command-palette-results"
				role="listbox"
				aria-label="Results"
				class="flex-1 overflow-y-auto p-2 sm:max-h-[60vh] sm:flex-none"
			>
				{#if loading && allResults.length === 0}
					<div class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
				{:else if inPicker}
					<!-- Default screen: what needs a person, then the categories. -->
					{@const kindCounts = (() => {
						const c: Record<ResultKind, number> = {
							rollout: 0,
							app: 0,
							env: 0,
							namespace: 0,
							action: 0
						};
						for (const r of allResults) c[r.kind]++;
						return c;
					})()}
					{#if attentionShown.length > 0}
						<div class="flex items-center gap-2 px-3 pb-1 pt-2" role="presentation">
							<span
								class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
								>Needs you</span
							>
							<span
								class="h-px flex-1 bg-gradient-to-r from-gray-200 to-transparent dark:from-gray-700"
							></span>
							<!-- THE TRUE TOTAL, NOT THE DRAWN COUNT. The cap hides rows;
							     it may never hide the number. -->
							<span class="font-mono text-[10px] tabular-nums text-gray-500 dark:text-gray-400"
								>{attention.length}</span
							>
						</div>
						{#each attentionShown as r, i (r.key)}
							{@render resultRow(r, i)}
						{/each}
						{#if attention.length > attentionShown.length}
							<p class="px-3 pb-1 pt-1 text-[11px] text-gray-500 dark:text-gray-400">
								and {attention.length - attentionShown.length} more — type to find one, or open
								<a href="/" class="underline hover:text-gray-700 dark:hover:text-gray-200"
									>Fleet overview</a
								>
							</p>
						{/if}
					{/if}
					<div class="px-2 pb-1 pt-2" role="presentation">
						<span
							class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
							>Browse</span
						>
					</div>
					<div class="grid gap-1.5 px-1 sm:grid-cols-2" role="presentation">
						{#each PICKER_KINDS as kind, kindIdx}
							{@const KIcon = KIND_ICON[kind]}
							{@const tileIdx = attentionShown.length + kindIdx}
							{@const sel = tileIdx === selectedIndex}
							<button
								type="button"
								role="option"
								id={`cp-opt-${tileIdx}`}
								aria-selected={sel}
								data-idx={tileIdx}
								onclick={() => {
									scope = kind;
									selectedIndex = 0;
									searchInput?.focus();
								}}
								onmouseenter={() => (selectedIndex = tileIdx)}
								class="group flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-3 text-left transition-colors dark:border-gray-700 {sel
									? 'bg-blue-50/70 dark:bg-blue-900/30'
									: 'bg-gray-50/50 hover:bg-gray-100 dark:bg-gray-700/30 dark:hover:bg-gray-700/60'}"
							>
								<span
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-gray-600 shadow-sm dark:bg-gray-800 dark:text-gray-400"
								>
									<KIcon class="h-4 w-4" />
								</span>
								<span class="flex flex-1 flex-col gap-0.5">
									<span class="text-sm font-medium text-gray-900 dark:text-white"
										>{KIND_LABEL[kind]}</span
									>
									<span class="text-[11px] text-gray-500 dark:text-gray-400"
										>{kindCounts[kind]}
										{kindCounts[kind] === 1
											? KIND_SINGULAR[kind]
											: KIND_LABEL[kind].toLowerCase()}</span
									>
								</span>
								<span
									class="text-gray-500 group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-200"
									aria-hidden="true">›</span
								>
							</button>
						{/each}
					</div>
					<div class="mt-3 border-t border-gray-100 px-2 pb-1 pt-3 dark:border-gray-700/60" role="presentation">
						<span
							class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
							>Or type to search across everything</span
						>
					</div>
				{:else if filtered.length === 0}
					<div class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
						No matches for
						<span class="font-medium text-gray-700 dark:text-gray-300">"{query}"</span>
					</div>
				{:else}
					{#each grouped as group (group.kind)}
						<div class="flex items-center gap-2 px-3 pb-1 pt-2" role="presentation">
							<span
								class="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
								>{group.label}</span
							>
							<span
								class="h-px flex-1 bg-gradient-to-r from-gray-200 to-transparent dark:from-gray-700"
							></span>
							<span class="font-mono text-[10px] tabular-nums text-gray-500 dark:text-gray-400"
								>{group.items.length}</span
							>
						</div>
						{#each group.items as item (item.result.key)}
							{@render resultRow(item.result, item.idx)}
						{/each}
					{/each}
				{/if}
			</div>

			<div
				class="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-4 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400"
			>
				<div class="hidden items-center gap-3 sm:flex">
					<span class="flex items-center gap-1">
						<kbd
							class="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono text-[10px] font-medium dark:border-gray-600 dark:bg-gray-700"
							>↑</kbd
						>
						<kbd
							class="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono text-[10px] font-medium dark:border-gray-600 dark:bg-gray-700"
							>↓</kbd
						>
						<span>navigate</span>
					</span>
					<span class="flex items-center gap-1">
						<kbd
							class="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono text-[10px] font-medium dark:border-gray-600 dark:bg-gray-700"
							>↵</kbd
						>
						<span>open</span>
					</span>
				</div>
				<!-- ⛔ THE COUNT COUNTS WHAT IS ON SCREEN, OR IT DOES NOT RENDER.
				     It used to print `128 results` over a four-tile category
				     picker: a number for a set the body was not showing, and the
				     only number on the default screen. Nothing takes its place —
				     the `Needs you` header and each tile already carry their own
				     count, and a slot kept warm for a number is the same defect
				     as a slot kept warm for an em dash. -->
				{#if !inPicker}
					<span>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes palette-in {
		0% {
			opacity: 0;
			transform: translateY(-6px) scale(0.97);
		}
		100% {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
	@keyframes backdrop-in {
		0% {
			opacity: 0;
		}
		100% {
			opacity: 1;
		}
	}
	.palette-enter {
		animation: palette-in 160ms cubic-bezier(0.16, 1, 0.3, 1);
		transform-origin: center top;
	}
	.backdrop-enter {
		animation: backdrop-in 120ms ease-out;
	}
</style>
