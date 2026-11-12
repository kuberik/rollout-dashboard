<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ONE ROLLOUT'S DEPENDENCY GRAPH — three layers, left to right: what it
	 * waits on → this rollout → what waits on it. The rollout Dependencies
	 * tab's centrepiece. (2026-10-05, from the owner: *"the graph is
	 * essential, except that it could've probably been better designed / laid
	 * out."*)
	 *
	 * ── NEW BY DESIGN, AND WHY NOT `DependencyNetwork` ──────────────────────
	 *
	 * Role: the local neighbourhood of ONE node, with the held edge as the
	 * first thing read. `DependencyNetwork` (the `/dependencies` canvas) is the
	 * right engine for the whole network — a services × environments matrix
	 * that needs dagre, pan and zoom — and was the tab's graph until bab0983.
	 * At one node's scale every one of those is a cost: the matrix closure
	 * drew `checkout-api`'s staging tab as ~20 boxes mostly unrelated to
	 * staging, the fit zoomed below the legibility floor, the pane scrolled
	 * inside the document, and edge labels were absolutely positioned by the
	 * library (the clipped `ents` label). A depth-1 neighbourhood always has
	 * the same three layers, so it needs no layout engine at all: a CSS grid
	 * places the boxes (no overlap by construction, text wraps instead of
	 * clipping), and an SVG overlay only draws the wires between boxes the
	 * grid already placed.
	 *
	 * What it REUSES: the data (`buildRolloutGraph` → `rolloutNeighbourhood`,
	 * the same nodes, edges and edge-state predicate `/dependencies` draws);
	 * the node anatomy (`DependencyNode`: env `Chip` + wrapping name + mono
	 * build, the focus ring); the two relation glyphs (`DependencyNetwork`'s
	 * legend: chevrons = environments, share-nodes = services); the quiet and
	 * dashed-unknown wires. The held hue is the product's `held` orange —
	 * `Chip role="held"`, `Card verdictTone="held"`, `StatusSpinner`'s held
	 * mark — the same tone the four cards beside it use for the same fact.
	 * Proportions borrow from `DependencyNode` (8px radius, 10/8 padding) and
	 * the Card body's 16px gutter.
	 *
	 * Narrow (< 672px of its own width): the layers stack vertically, and the
	 * wires become a tree spine down the left edge — each link still gets its
	 * own coloured wire and arrowhead, so a phone reads WHICH link is holding,
	 * not just a list.
	 */
	import Chip from '$lib/components/Chip.svelte';
	import { ArrowUpRightFromSquareOutline } from 'flowbite-svelte-icons';
	import { CLEAR_PIN_LABEL } from './pin-copy';
	import { stateWord } from '$lib/components/new/state-words';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import { StableOrder, RetainedRows } from '$lib/view-models/stable-order';
	import { holdHeight } from '$lib/smooth-height';
	import { shortEnvLabel, type EnvironmentTheme } from '$lib/environment-theme';
	import type { GraphNode } from '$lib/view-models/dependency-graph';
	import type { NeighbourLink, RolloutNeighbourhood } from '$lib/view-models/rollout-neighbourhood';
	import { withoutSupersededBoxes, type GateBox } from '$lib/view-models/rollout-gates';
	import ApproveButton from '$lib/components/new/ApproveButton.svelte';
	import { approvalWord, ASK_LOADING } from '$lib/components/new/state-words';
	import { fade } from 'svelte/transition';
	import type { ApprovalTarget } from '$lib/components/new/data';
	import { theme as themeStore } from '$lib/stores/theme';
	import { ARROW, ARROW_PATH, ARROW_VIEWBOX, WIRE_INK, DASH, dashOffsetForLength, wireKind } from '$lib/graph-arrow';
	import {
		wideWires,
		narrowWires,
		holdingFirst,
		maxRise,
		type Wire,
		type WireIn
	} from '$lib/view-models/hood-wires';

	let {
		hood,
		themeOf = () => null,
		hrefOf = () => null,
		heldBuildsOverride,
		onClearPin = null,
		approveAsk = null,
		clearPinDisabled = false,
		reconciledUpstream,
		elsewhereCountOverride,
		peerHeldByEnv,
		chainWait = null,
		focusWaitsFor = null,
		approvedFacts = []
	}: {
		hood: RolloutNeighbourhood;
		themeOf?: (env: string) => EnvironmentTheme | null;
		/** Where a neighbour box links. `null` for a rollout with no page. */
		hrefOf?: (n: GraphNode) => string | null;
		/**
		 * ⭐ THE FOCUS BOX'S OWN HELD LIST, OVERRIDABLE. (2026-10-09,
		 * coordinator correction.) `hood.heldBuilds` is the GRAPH's own
		 * per-edge read (via `buildRolloutGraph`/`allDeps`), which can name a
		 * DIFFERENT build than `rollout.status.gates` does for the same
		 * rollout — measured live, `checkout-api/prod-us-east-2`: the graph
		 * attributes the contract hold to `4.43.0-43` while
		 * `promotionHoldBreakdown` (status.gates, the SAME source the
		 * Overview's "Newer builds" rows and the Change Version dialog read)
		 * says `4.43.0-43` can deploy and `4.44.0-44`/`4.45.0-45` are what
		 * wait. The "Gated by" column's own per-edge boxes are untouched —
		 * they still show the dependency/promotion split in full — only the
		 * FOCUS box's summary line takes the override, so it cannot
		 * contradict the page's own lead row and header meta one scroll
		 * away. `undefined` (the default) keeps today's behaviour for any
		 * other caller of this component.
		 */
		heldBuildsOverride?: string[];
		/** The pin box's own action: the Overview's Clear pin, one dialog. Null draws no button (no permission, or not pinned). */
		onClearPin?: (() => void) | null;
		/** The approval the viewer can give at this rollout (data.ts `approvalAskAt`, the one Home offers): the held approval gate says "Needs your approval" and carries Approve instead of "How to approve". Null: today's words. */
		approveAsk?: ApprovalTarget | typeof ASK_LOADING | null;
		/** The builds this place's approval gate has been given an approval for, as the place's own RolloutApprovals say it (`approvedFactOf`): "c0d3e88 · approved by wyatt" under the approval gate, held or not, so an approved build never reads as merely not held. */
		approvedFacts?: { build: string; text: string; title: string }[];
		/** Another manager owns `spec.wantedVersion`: the same disabled state the Overview's Clear pin shows (`dashboardManagesWantedVersion`). */
		clearPinDisabled?: boolean;
		/**
		 * ⭐ THE "Gated by" COLUMN'S OWN LINKS, RECONCILED (2026-10-10 — round
		 * 4, item 1). `hood.upstream`'s per-edge `state` can disagree with
		 * `promotionHoldBreakdown`'s per-build read for the SAME gate — the
		 * live defect: the staging-first link drew "Nothing held" beside a
		 * lead row correctly naming two builds it refused. The caller passes
		 * `reconcileNeighbourhoodHolds(hood.upstream, holdBreakdown)`'s own
		 * `upstream` array; `undefined` keeps `hood.upstream` verbatim for any
		 * other caller.
		 */
		reconciledUpstream?: NeighbourLink[];
		/**
		 * ⭐ "ONE SERVICE, TWO COUNTS" (squad-rollout Lane G round 5, item A,
		 * AD ruling). A contract tile's own edge only ever reports what IT
		 * holds for the FOCUS — always "here" — while the "Waiting on" card
		 * one scroll away states the SAME provider's app-wide held count
		 * (every environment this app runs in). Measured live: canvas said
		 * "Holding 4.43.0-43" (1), "Waiting on" said "holding 3 builds"
		 * (fleet-wide) — two numbers for one provider, neither saying which
		 * scope it was. Keyed on the provider's NODE NAME (`l.node.name` for
		 * an upstream contract link), value = how many OTHER environments'
		 * builds that provider holds, beyond this one. `undefined`/absent
		 * leaves `statusLine` exactly as before (build id named, no "N
		 * elsewhere" clause) for any other caller.
		 */
		elsewhereCountOverride?: ReadonlyMap<string, number>;
		/**
		 * ⭐ "`<stage>` HELD ON `<cause>`", ONE HOP, FOR A CHAIN LINK (qa11
		 * finding, squad-rollout gates-2 follow-up). Keyed on the upstream
		 * link's own raw env name (`NeighbourLink.node.env`) — the SAME
		 * `peersByEnv`/`waitsFor` one-hop composition the Overview/Gates
		 * lead row and the "Newer builds" rows already use, just reaching
		 * the canvas. `undefined`/absent: a chain link still reads "Waits
		 * for `<env>`" with no second clause, never a guess.
		 */
		peerHeldByEnv?: ReadonlyMap<string, { state?: string; held: boolean; causeLabel: string | null }>;
		/**
		 * ⭐ "WAITS FOR `<stage>`", ON THE FOCUS BOX TOO (qa11 finding,
		 * squad-rollout gates-2 follow-up, 2026-10-11). When
		 * `heldBuildsOverride`/`hood.heldBuilds` is empty because every
		 * candidate is only chain-refused — this rollout has not reached
		 * yet, never held — "No build held here" is itself a claim this
		 * page can do better than: the caller's own `waitsFor` sentence
		 * ("Waits for staging · staging held on payments-svc") replaces it.
		 * `null` (the default) keeps "No build held here" for the
		 * genuinely calm case.
		 */
		focusWaitsFor?: string | null;
		/**
		 * The card's wave/site wait sentence (`RolloutCard.waveWait`), read once
		 * from blocking-story. Printed on the chain tile it names (or, when no
		 * tile carries that name, on the first chain tile) instead of "Waits for
		 * <env>".
		 */
		chainWait?: { stage: string; text: string } | null;
	} = $props();

	const focusHeldBuilds = $derived(heldBuildsOverride ?? hood.heldBuilds);
	const upstreamLinks = $derived(reconciledUpstream ?? hood.upstream);

	/** Same threshold the grid's container query uses (42rem). */
	const WIDE_AT = 672;
	const uid = `nh-${Math.random().toString(36).slice(2, 8)}`;

	let root = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let wires = $state<Wire[]>([]);
	let box = $state({ w: 0, h: 0 });
	/** Widened gutter when the fan is steep (see `measure`); kept for the focus. */
	let steep = $state(false);
	let steepFor: string | null = null;

	const focus = $derived(hood.focus);

	/**
	 * ⭐ A GATE BOX THAT DROPS OFF `hood.gates` STAYS, MARKED RELEASED.
	 * (2026-10-08.) A health box vanishes the instant checks pass, a window's
	 * box never vanishes (it draws even open) — but a one-off external gate
	 * CAN leave `hood.gates` the moment it stops holding anything AND no
	 * object/summary names it any more. Dropping its box mid-visit would move
	 * every row below it, exactly the jump `RetainedRows` already exists to
	 * stop for the held-builds card one level up. Reset per focus.
	 */
	const gateRetainer = new RetainedRows<GateBox>();
	const displayedGates = $derived.by<GateBox[]>(() => {
		const retained = withoutSupersededBoxes(gateRetainer.apply(focus?.id ?? '', hood.gates, (g) => g.key), hood.gates);
		return retained.map(({ row, resolved }) =>
			resolved ? { ...row, state: 'clear' as const, phrase: 'passing now', held: [] } : row
		);
	});
	/**
	 * ⭐ THE "Gated by" COUNT: GATES ONLY, THE PREDECESSOR NAMED (qa11b 2026-10-11;
	 * QA #15 + TL follow-up 2026-11-09). A chain predecessor is an environment
	 * the build must pass first, not a gate, so it is excluded from the number
	 * exactly as `rolloutNeighbourhood`'s `holding`/`heldLinks` and the Gates
	 * tab's meta row and card rollup (`realGateTotal`) exclude it. Because the
	 * predecessor's box IS drawn in the column, the head names it
	 * ("Gated by · 2 + staging") so the boxes and the number never disagree.
	 */
	const gatedByCount = $derived(
		upstreamLinks.filter((l) => !l.chainPredecessor).length + displayedGates.length
	);
	const chainEnvNames = $derived(
		[...new Set(upstreamLinks.filter((l) => l.chainPredecessor).map((l) => l.node.env))]
	);

	/**
	 * ⭐ GATE BOXES RIDE IN THE UPSTREAM ("Gated by") COLUMN, MERGED WITH THE
	 * UPSTREAM LINKS INTO ONE ORDERED LIST. (2026-10-08, the Gates tab.) A
	 * gate box is a gate with no rollout on the far end — see this
	 * component's own module doc comment below for why it is a box of its
	 * own and not a `NeighbourLink`.
	 */
	type UpItem =
		| { kind: 'link'; state: 'blocked' | 'clear' | 'unknown'; key: string; link: NeighbourLink }
		| { kind: 'gate'; state: 'blocked' | 'clear' | 'unknown'; key: string; box: GateBox };

	const STATE_ORDER = { blocked: 0, unknown: 1, clear: 2 } as const;
	/** Links before gate boxes, promotion links before contract links. */
	const typeRank = (i: UpItem) =>
		i.kind === 'gate' ? 2 : i.link.writer === 'promotion' ? 0 : 1;
	const nameOf = (i: UpItem) => (i.kind === 'link' ? i.link.node.name : i.box.title);

	function mergedUpstream(links: readonly NeighbourLink[], boxes: readonly GateBox[]): UpItem[] {
		const items: UpItem[] = [
			...links.map((l) => ({ kind: 'link' as const, state: l.state, key: l.key, link: l })),
			...boxes.map((b) => ({ kind: 'gate' as const, state: b.state, key: `gate:${b.key}`, box: b }))
		];
		return items.sort(
			(a, b) =>
				STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
				typeRank(a) - typeRank(b) ||
				nameOf(a).localeCompare(nameOf(b))
		);
	}

	/**
	 * Held first on arrival, then STABLE while the page is open — see
	 * `stable-order.ts`. A hold clearing over the stream must not move the row
	 * the reader is watching. Reset per focus, so navigating re-sorts.
	 */
	const upOrder = new StableOrder();
	const downOrder = new StableOrder();
	// A live update within one focus keeps rows in place; navigating re-sorts.
	//
	// ⭐ THE ITEM COUNT RIDES THE KEY TOO. (2026-10-08) Gate boxes are not all
	// known on the same frame: `schedules`/`healthChecks` resolve a request
	// after the rollout/list payload does, so a schedule's box can arrive a
	// beat after an external gate's. Without this, `StableOrder` (correctly,
	// by its own rule) treated the late box as a brand-new row and appended
	// it after every already-held link — "Business hours" landed dead last,
	// behind a holding link, instead of beside "Release approval" where the
	// sort puts it. Folding the count into the reset key means the order
	// locks in once (arrival), not on the first INCOMPLETE frame.
	const upMerged = $derived(mergedUpstream(upstreamLinks, displayedGates));
	/**
	 * ⭐ ONE ORDER AT EVERY WIDTH. `holdingFirst`: a link or gate that holds this rollout is first, at 1440 and at 390, so the card
	 * that says why nothing moves is never the one a phone's fold slices. (It used to put held items LAST at narrow, to keep the
	 * orange trunk short; the reader's first need outranks the wire's economy.)
	 */
	const upstream = $derived(
		upOrder.apply(
			`${focus?.id ?? ''}|${upMerged.length}`,
			holdingFirst(upMerged),
			(i) => i.key
		)
	);
	const downstream = $derived(downOrder.apply(focus?.id ?? '', hood.downstream, (l) => l.key));
	const envLabel = (env: string) => shortEnvLabel(themeOf(env)) || env;

	function shortList(builds: string[]): string {
		if (builds.length <= 2) return builds.join(', ');
		return `${builds.slice(0, 2).join(', ')} +${builds.length - 2}`;
	}

	/**
	 * ⭐ THE STATUS LINE'S OWN 16px GLYPH (squad-rollout Lane G round 4, item
	 * 4 — the AD's own ruling: "drop the 32px discs", one 16px glyph on the
	 * status line, Railway's own anatomy). `blocked` → `held` (orange ring,
	 * pause glyph); `clear` → `newest` (the quiet success rest dot, no ring —
	 * a passing gate spends no hue); `unknown` → `checking` (the product's
	 * one mark for "not yet known").
	 */
	function markState(s: 'blocked' | 'clear' | 'unknown'): 'held' | 'newest' | 'checking' {
		if (s === 'blocked') return 'held';
		if (s === 'unknown') return 'checking';
		return 'newest';
	}

	function peerWord(l: NeighbourLink): string | null {
		const peer = peerHeldByEnv?.get(l.node.env);
		return peer && !peer.held ? stateWord(peer.state) : null;
	}
	/** The tile's mark: the held mark for a held peer (its line says "held on <cause>"), the peer's own verdict (checking / deploying / failing) when it has not passed the build, else the passed mark. */
	function chainMark(l: NeighbourLink): 'held' | 'newest' | 'checking' | 'deploying' | 'failed' {
		const peer = peerHeldByEnv?.get(l.node.env);
		if (peer?.held && peer.causeLabel) return 'held';
		const st = peer?.state;
		return peerWord(l) && (st === 'checking' || st === 'deploying' || st === 'failed') ? st : 'newest';
	}
	/**
	 * ⭐ "WAITS FOR `<stage>`", NEUTRAL — THE CHAIN LINK'S OWN SENTENCE
	 * (qa11 finding, squad-rollout gates-2 follow-up, 2026-10-11). A
	 * `chainPredecessor` link never reads `headline`/`statusLine` (those
	 * are the "something refuses this HERE" sentences) — this is the
	 * SAME one-hop composition `waitsFor`/the "Newer builds" rows already
	 * print: the stage name alone, plus "`<stage>` held on `<cause>`"
	 * exactly when `peerHeldByEnv` says that peer is itself really held.
	 */
	function chainWaitsForText(l: NeighbourLink): string {
		if (chainWait) {
			const first = upstreamLinks.find((x) => x.chainPredecessor);
			const named = upstreamLinks.some((x) => x.chainPredecessor && x.node.env === chainWait.stage);
			if (named ? l.node.env === chainWait.stage : l === first) return chainWait.text;
		}
		const peer = peerHeldByEnv?.get(l.node.env);
		// The raw env name, same convention `waitsFor`/the "Newer builds"
		// rows already print ("Waits for staging"), never the Chip's own
		// abbreviated label.
		if (peer?.held && peer.causeLabel) return `Waits for ${l.node.env} · ${l.node.env} held on ${peer.causeLabel}`;
		// A peer still checking / deploying / failing its own build has NOT passed: it reads the place verdict word the app page and /rollouts print.
		const word = peerWord(l);
		if (word) return `${word} · Promotion`;
		// Reaching here means the predecessor holds nothing (no chain wait, no held peer): the build already passed it. "Waits for staging"
		// beside a green dot read as staging itself waiting (QA, TL follow-up).
		return 'Nothing held · Promotion';
	}

	/** The headline half of a tile's one status line: the edge's state, held first and loud. */
	function headline(l: NeighbourLink): string {
		if (l.state === 'blocked') {
			const what = l.held.length > 0 ? shortList(l.held) : 'newer builds';
			// Upstream: the build is the FOCUS's, and this link holds it.
			// Downstream: the build is the BOX's own, held on the focus.
			return l.side === 'upstream' ? `Holding ${what}` : `${what} held downstream`;
		}
		if (l.state === 'unknown') return 'State not reported';
		return 'Nothing held';
	}

	/**
	 * ⭐ ONE TRUE STATUS LINE PER TILE (squad-rollout Lane G round 4, items 4
	 * and 5, AD ruling). The tile used to carry the headline AND a second,
	 * longer clause restating the provider's name (already the tile's own
	 * title line) and its served version ("has 2.4.1" — already printed on
	 * the "Held builds"/"Waiting on" cards one scroll away): "a tile says
	 * only what that gate does", not everything the page already says about
	 * it elsewhere.
	 *
	 * ⭐ ROUND 6: THE RELATION HALF MOVED TO `releaseSentence` (SPEC §7,
	 * below) — "needs ~2.9.0" and "staging deploys first" are now subsumed
	 * by "Releases when payments-svc ships ~2.9.0" / "Releases when staging
	 * deploys 4.45.0-45", a MORE specific fact than either. Restating both
	 * would be the exact restatement item 5 (round 4) already closed once;
	 * the status line now states only the COUNT/IDENTITY half (which builds,
	 * here vs elsewhere), the release sentence states the CONDITION.
	 */
	function statusLine(l: NeighbourLink): string {
		if (l.writer === 'contract' && l.state === 'blocked') {
			// ⭐ SCOPED COUNTS, NOT A BARE BUILD ID (round 5, item A — see
			// `elsewhereCountOverride`'s own doc comment). `l.held.length` is
			// always THIS environment's own held count (the edge can only ever
			// report what it holds for the focus); `elsewhere` is the rest of
			// the app, read off the SAME breakdown "Waiting on" uses.
			const here = l.held.length || 1;
			const elsewhere = l.side === 'upstream' ? (elsewhereCountOverride?.get(l.node.name) ?? 0) : 0;
			// ⭐ ROUND 6, "DROP ZERO PARTS" (item 4's own ruling, applied here
			// too for the identical fact): never "0 elsewhere" — the clause is
			// omitted outright rather than printing a zero nobody needs.
			// Builds, named once: the Held builds rollup beside the tile counts builds too.
			const hereBuilds = `${here} ${here === 1 ? 'build' : 'builds'}`;
			return elsewhere > 0
				? `Holding ${hereBuilds} here · ${elsewhere} elsewhere`
				: `Holding ${hereBuilds} here`;
		}
		return headline(l);
	}

	/** Same one-line idea as `statusLine`, for a gate box (no second rollout
	 *  to name — its own kind word, if any, still earns a place since
	 *  nothing else states "Approval"/"Deploy window" for it). */
	function gateBoxStatusLine(b: GateBox): string {
		const head =
			b.state === 'blocked'
				? `Holding ${b.held.length > 0 ? shortList(b.held) : 'newer builds'}`
				: b.state === 'unknown'
					? 'State not reported'
					: 'Nothing held';
		return b.kindWord ? `${head} · ${b.kindWord}` : head;
	}

	/**
	 * ⭐ SPEC §7 (owner-driven, 2026-10-10): "every holding tile states its
	 * release in words." One sentence, built only from what the tile already
	 * has — never a fourth read of the same fact. `null` for a tile that
	 * holds nothing (nothing to release).
	 */
	/** The sentence split so every environment / rollout name is one unbreakable token (a name never breaks at its hyphen; the chips don't either). */
	function releaseParts(l: NeighbourLink): { t: string; nb: boolean }[] | null {
		const s = releaseSentence(l);
		if (!s) return null;
		const names = [l.node.name, l.node.env ? envLabel(l.node.env) : '', focus?.name ?? '', focus?.env ? envLabel(focus.env) : ''].filter((n): n is string => !!n && n.includes('-'));
		if (!names.length) return [{ t: s, nb: false }];
		const re = new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`);
		return s.split(re).filter(Boolean).map((t) => ({ t, nb: names.includes(t) }));
	}
	function releaseSentence(l: NeighbourLink): string | null {
		if (l.state !== 'blocked') return null;
		// DOWNSTREAM: the box is the one HELD, and the focus is what it waits on. "Releases when <box env> deploys X" read as the box releasing
		// itself, so the line names both ends: releases TO the box WHEN the focus deploys / ships it. Upstream keeps the old subject-less form
		// (the held build is the focus's own, so "Releases when staging deploys X" is about this page's rollout).
		if (l.side === 'downstream' && focus) {
			if (l.writer === 'contract') {
				return l.requiredVersion
					? `Releases to ${l.node.name} when ${focus.name} ships ${l.requiredVersion}`.replace(/ (?=\S+$)/, '\u00a0')
					: `Releases to ${l.node.name} when ${focus.name} ships a newer version`;
			}
			// An empty `held` names no build: "its first build" keeps the subject (the focus) and never dangles an "it".
			const b = l.held[0];
			return `Releases to ${envLabel(l.node.env)} when ${envLabel(focus.env)} deploys ${b ?? 'its first build'}`;
		}
		if (l.writer === 'contract') {
			// A NON-BREAKING SPACE inside the version clause (round 6 nit): a
			// plain space let "~2.9.0" wrap away from its own sentence,
			// orphaned at a line end. The clause is short enough that gluing
			// it into one unbreakable run costs nothing.
			return l.requiredVersion
				? `Releases when ${l.node.name} ships ${l.requiredVersion}`.replace(/ (?=\S+$)/, ' ')
				: `Releases when ${l.node.name} ships a newer version`;
		}
		// Promotion: the NEWEST build this edge holds is the one staging (or
		// whichever upstream environment) has to reach first.
		const build = l.held[0];
		return build
			? `Releases when ${envLabel(l.node.env)} deploys ${build}`
			: `Releases when ${envLabel(l.node.env)} deploys first`;
	}

	/** Same idea as `releaseSentence`, for a gate box — `b.mark.clears` is
	 *  the product's own one-per-kind read (`GateRecord.svelte`'s own
	 *  `gateMark`), so this never re-decides what kind of gate it is. */
	function gateBoxReleaseSentence(b: GateBox): string | null {
		if (b.state !== 'blocked') return null;
		if (b.mark.clears === 'pin') return 'Releases when the pin is cleared';
		if (b.mark.clears === 'person') return 'Releases when someone approves';
		if (b.mark.clears === 'clock') return 'Releases when the deploy window opens';
		if (b.mark.clears === 'check') return 'Releases when the check starts passing';
		return 'Releases when the rule allows this build';
	}

	/**
	 * ⭐ THE TILE'S OWN ACTION (SPEC §7): "Open payments-svc" / "Open
	 * staging" — the SAME destination the tile itself already links to
	 * (`hrefOf`), so this is never a second, independent link: it is the
	 * one the whole tile already offers, drawn as a visible affordance
	 * (`pointer-events-none` — the tile's own `<a>` carries the real click;
	 * a second interactive element nested inside it would be invalid HTML
	 * and a confusing double tab-stop for the identical destination).
	 */
	function actionLabel(l: NeighbourLink): string | null {
		if (l.state !== 'blocked') return null;
		return l.writer === 'contract' ? `Open ${l.node.name}` : `Open ${envLabel(l.node.env)}`;
	}

	/**
	 * THE WIRES, read off the boxes the grid already placed (geometry in
	 * `hood-wires.ts`). Nothing here positions a box; a wire that is wrong can
	 * only be drawn wrong, never push a label under a neighbour.
	 */
	function measure() {
		if (!root) return;
		/**
		 * ⛔ LOCAL, UNZOOMED CSS PX — NOT RAW CLIENT RECTS. Under CSS `zoom` on an
		 * ancestor (every demo-video capture runs `html { zoom: 1.333 }`)
		 * `getBoundingClientRect` is in ZOOMED px while this SVG draws in the
		 * tree's own px. `currentCSSZoom` is the element's effective zoom; the
		 * `offsetWidth` ratio is the fallback for engines without it.
		 */
		const r = root.getBoundingClientRect();
		const cz = (root as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom;
		const z = cz && cz > 0 ? cz : root.offsetWidth > 0 ? r.width / root.offsetWidth || 1 : 1;
		const local = (el: Element) => {
			const b = el.getBoundingClientRect();
			const left = (b.left - r.left) / z;
			const top = (b.top - r.top) / z;
			const w = b.width / z;
			const h = b.height / z;
			return { left, top, right: left + w, bottom: top + h, width: w, height: h };
		};
		box = { w: root.offsetWidth, h: root.offsetHeight };
		width = root.offsetWidth;
		const focusEl = root.querySelector<HTMLElement>('[data-hood-focus]');
		if (!focusEl) {
			wires = [];
			return;
		}
		const f = local(focusEl);
		const read = (side: 'upstream' | 'downstream'): WireIn[] =>
			[...root!.querySelectorAll<HTMLElement>(`[data-hood-link="${side}"]`)].map((el, i) => ({
				key: el.dataset.key ?? `${side}-${i}`,
				state: (el.dataset.state ?? 'clear') as WireIn['state'],
				rect: local(el)
			}));
		const up = read('upstream');
		const down = read('downstream');
		if (width >= WIDE_AT) {
			// A steep fan (rise > 2× the gutter) gets the wider gutter, once per focus.
			const gutter = up.length ? f.left - Math.max(...up.map((w) => w.rect.right)) : 72;
			if (steepFor !== focus?.id) {
				steepFor = focus?.id ?? null;
				steep = false;
			}
			if (!steep && maxRise(f, up, down) > 2 * gutter) steep = true;
			wires = wideWires(f, up, down);
		} else {
			wires = narrowWires(f, up, down);
		}
	}

	/** Ends a dashed (unread) wire on a dash, so its head sits on ink. */
	function endOnDash(node: SVGPathElement, dashed: boolean) {
		const apply = (on: boolean) => {
			if (!on) return node.removeAttribute('stroke-dashoffset');
			const len = typeof node.getTotalLength === 'function' ? node.getTotalLength() : 0;
			node.setAttribute('stroke-dashoffset', String(dashOffsetForLength(len)));
		};
		apply(dashed);
		return { update: apply };
	}

	$effect(() => {
		void hood;
		if (!root) return;
		const ro = new ResizeObserver(() => measure());
		ro.observe(root);
		for (const el of root.querySelectorAll('[data-hood-link],[data-hood-focus]')) ro.observe(el);
		measure();
		return () => ro.disconnect();
	});

	const WIRE_KINDS = ['held', 'quiet'] as const;
	const dark = $derived($themeStore === 'dark');
	const ink = (k: 'held' | 'quiet') => (dark ? WIRE_INK[k].dark : WIRE_INK[k].light);
</script>

{#snippet linkBox(l: NeighbourLink)}
	{@const theme = themeOf(l.node.env)}
	{@const href = l.node.unresolved ? null : hrefOf(l.node)}
	<!-- ⭐ A CHAIN PREDECESSOR IS NEVER DRAWN HELD (qa11 finding, squad-rollout
	     gates-2 follow-up, 2026-10-11). `l.chainPredecessor` — never `l.state`,
	     which the raw edge AND the breakdown-reconciled read have both been
	     observed `blocked` for a link that is plain chain sequencing — forces
	     this tile's own `held` to `false`: no held ink, no pause glyph, no
	     "Holding …" headline. See `chainWaitsForText`'s own doc comment for
	     the sentence it reads instead. -->
	{@const held = l.state === 'blocked' && !l.chainPredecessor}
	<!-- ⭐ THE PRODUCT'S FOCUS RING, NAMED. `transition-colors` also animated
	     `outline-color`, so a keyboard focus landed as a white ring fading
	     toward `--focus-ring-color` (blue-500 / blue-400) — read as a second,
	     white focus style. Only the border animates now (the hover), and the
	     outline states the token explicitly. -->
	<svelte:element
		this={href ? 'a' : 'div'}
		{href}
		data-hood-link={l.side}
		use:holdHeight={focus?.id}
		data-state={l.state}
		data-key={l.key}
		title={href ? `Open ${l.node.name} in ${l.node.env}` : undefined}
		class="hood-tile flex min-w-0 flex-col justify-center gap-1.5 rounded-md border p-3 transition-[border-color]
			focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]
			{held
			? 'border-held-line bg-surface'
			: l.node.unresolved
				? 'border-dashed border-line-strong bg-subtle'
				: 'border-line bg-surface'}
			{href ? 'hover:border-line-strong' : ''}"
	>
		<!-- ⭐ ONE TILE ANATOMY (squad-rollout Lane G round 4, item 4, AD
		     ruling): name + env chip / build `t-code-sm` / one status line
		     with a 16px glyph — Railway's own object (identity on top, one
		     status line with an icon at the bottom), no leading 32px disc. -->
		<span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
			<span class="t-card-title min-w-0 break-words text-fg">{l.node.name}</span>
			<!-- ⛔ AN ENV CHIP ONLY WHEN THERE IS AN ENVIRONMENT — main's #40 rule for
			     `DependencyNode`, applied to this view of the same graph. `node.env`
			     falls back to the NAMESPACE when no Environment maps it, and a chip
			     with no theme renders as a bare bordered box. -->
			{#if theme}
				<Chip role="env" {theme} label={envLabel(l.node.env)} title={l.node.env} wide class="shrink-0" />
			{:else if l.node.env}
				<!-- A namespace or an env name — both are NAMES (sans), never mono;
				     only the build figure below is a machine id. -->
				<span class="t-meta shrink-0 text-fg-subtle">{l.node.env}</span>
			{/if}
		</span>
		{#if l.node.build}
			<p class="t-code-sm min-w-0 truncate text-fg-subtle">{l.node.build}</p>
		{:else if l.node.unresolved}
			<p class="t-meta text-fg-subtle">not in this dashboard</p>
		{/if}
		<!-- ⭐ NEVER ELLIPSIZED (squad-rollout Lane G round 5, item B, AD
		     ruling): a `truncate` status line clipped the hold reason to
		     "· sta…" at 390 — the one fact this tile exists to state, cut
		     off. `items-start` (was `items-center`) so a two-line wrap keeps
		     the glyph pinned to the FIRST line instead of centring against
		     the wrapped box's full height. -->
		<p class="flex min-w-0 items-start gap-1.5 t-meta {held ? 'text-held' : 'text-fg-subtle'}">
			<span class="mt-0.5 shrink-0"
				><StatusMark state={l.chainPredecessor ? chainMark(l) : markState(l.state)} /></span
			>
			<span class="min-w-0 break-words">{l.chainPredecessor ? chainWaitsForText(l) : statusLine(l)}</span>
		</p>
		{#if held}
			<!-- ⭐ SPEC §7 (owner-driven, 2026-10-10): "every holding tile
			     states its release in words" — `releaseSentence` above, the
			     CONDITION half the status line no longer restates. -->
			<p class="t-meta min-w-0 break-words text-fg-muted">{#each releaseParts(l) ?? [] as p}{#if p.nb}<span class="whitespace-nowrap">{p.t}</span>{:else}{p.t}{/if}{/each}</p>
			{#if actionLabel(l)}
				<!-- ⭐ THE ACTION, drawn but not a second interactive element
				     (`pointer-events-none`, `aria-hidden` — see `actionLabel`'s
				     own comment: the tile itself is already the `<a>` to this
				     exact destination, named by its own `title`). -->
				<span
					class="btn btn-xs btn-secondary pointer-events-none mt-0.5 self-start"
					aria-hidden="true">{actionLabel(l)}</span
				>
			{/if}
		{/if}
	</svelte:element>
{/snippet}

{#snippet gateBox(b: GateBox)}
	{@const held = b.state === 'blocked'}
	<!-- ⭐ "HOW TO APPROVE" (SPEC §7, round 6; RECONFIRMED squad-rollout
	     gates-2 follow-up, 2026-10-11 — coordinator correction). There is
	     still no approval endpoint: `ChangeVersionModal` POSTs
	     `/change-version`, which BYPASSES the gate rather than approving
	     it, so wiring this tile to open that dialog would be a bypass
	     wearing an "Approve" label. A held APPROVAL gate box links OUT to
	     the docs instead, per the spec's own fallback, until a real
	     approval endpoint exists (tl-integrate's call). Every other gate
	     kind (deploy window, check, freeze) still has no destination — the
	     spec names only Approve/Open-provider/Open-env as actions, so none
	     is invented for them, and no button is drawn where the only
	     destination would be this same page. -->
	{@const askRaw = held && b.mark.clears === 'person' ? approveAsk : null}
	{@const loading = askRaw === ASK_LOADING}
	{@const ask = askRaw && askRaw !== ASK_LOADING ? askRaw : null}
	{@const docsHref = held && b.mark.clears === 'person' && !ask && !loading ? 'https://docs.kuberik.com/concepts/gates#approvals' : null}
	<!--
		⭐ NEW BY DESIGN. (2026-10-08, the Gates tab.) ROLE: a gate holding this
		rollout that has NO rollout on the far end — a deploy window, a freeze,
		an external approval, health, a pin (`rollout-gates.ts`'s `GateBox`).
		WHY NOT AN EXISTING COMPONENT: `DependencyNode`/the `linkBox` snippet
		above both need a second ROLLOUT to draw an env chip and a build for —
		this object has neither, by definition. `BlockingStoryLines` draws the
		same facts as PROSE rows in a banner, not as a box inside this grid.
		PROPORTIONS: this is `linkBox`'s own shell verbatim (round 4: the SAME
		one-status-line anatomy, no build line since a gate box has no second
		rollout to run one). It is a `div` UNLESS it is a held approval (round
		6) — the one gate kind with somewhere to send the reader.
	-->
	<svelte:element
		this={docsHref ? 'a' : 'div'}
		href={docsHref}
		target={docsHref ? '_blank' : undefined}
		rel={docsHref ? 'noreferrer' : undefined}
		data-hood-link="upstream"
		use:holdHeight={focus?.id}
		data-state={b.state}
		data-key={`gate:${b.key}`}
		title={docsHref ? 'How to approve a held build' : b.gates.length > 0 ? b.gates.join(', ') : undefined}
		class="hood-tile flex min-w-0 flex-col justify-center gap-1.5 rounded-md border p-3 transition-[border-color]
			{held ? 'border-held-line bg-surface' : 'border-line bg-surface'}
			{docsHref ? 'hover:border-line-strong' : ''}"
	>
		<span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
			<span class="t-card-title min-w-0 break-words text-fg">{b.title}</span>
		</span>
		<p class="flex min-w-0 items-start gap-1.5 t-meta {held ? 'text-held' : 'text-fg-subtle'}">
			<span class="mt-0.5 shrink-0"><StatusMark state={markState(b.state)} /></span>
			<span class="min-w-0 break-words">{gateBoxStatusLine(b)}</span>
		</p>
		{#if b.kind === 'approval'}
			{#each approvedFacts as f (f.build)}
				<p class="t-meta min-w-0 break-words text-fg-muted" title={f.title} data-approved-build><span class="t-code text-fg">{f.build}</span> · {f.text}</p>
			{/each}
		{/if}
		{#if held}
			<p class="t-meta min-w-0 break-words text-fg-muted">{ask ? approvalWord(true) : loading ? approvalWord(false) : gateBoxReleaseSentence(b)}</p>
			{#if b.kind === 'pin' && onClearPin}
				<button type="button" class="btn btn-xs btn-secondary mt-0.5 self-start" disabled={clearPinDisabled} onclick={onClearPin}>{CLEAR_PIN_LABEL}</button>
			{/if}
			{#if ask}
				<span class="mt-0.5 self-start" in:fade={{ duration: 150 }}><ApproveButton target={ask} class="btn btn-primary btn-xs" scope /></span>
			{:else if loading}
				<!-- the button's own box, reserved while the fleet answers: Approve or "How to approve" lands in it, nothing moves -->
				<span class="mt-0.5 inline-block h-7 w-[72px] self-start" aria-hidden="true" data-approve-slot></span>
			{/if}
			{#if docsHref}
				<!-- ⭐ THE ↗ EXTERNAL GLYPH (final polish round, D2, AD ruling):
				     this button leaves the dashboard (the docs site), unlike
				     every other tile action ("Open payments-svc" / "Open
				     staging" stay inside the product) — the SAME external-link
				     icon the "Waiting on" card's own provider links already use
				     (`ArrowUpRightFromSquareOutline`), sized by `.btn-xs`'s own
				     rule (12px, `app.css`'s one icon-size ladder), not a second
				     one-off size. -->
				<span class="btn btn-xs btn-secondary pointer-events-none mt-0.5 self-start" aria-hidden="true">
					How to approve
					<ArrowUpRightFromSquareOutline />
				</span>
			{/if}
		{/if}
	</svelte:element>
{/snippet}

<!-- ⭐ THE EMPTY-COLUMN PLACEHOLDER (squad-rollout Lane G round 2, item 3):
     one quiet DASHED tile, same shell as every other tile on this canvas
     (`.hood-tile`, `rounded-md p-3`) so an empty column reads as "a column
     with nothing in it" rather than a bare floating word at a different
     scale from its neighbours. `border-dashed border-line-strong`, no
     `data-hood-link` — U-32(c)'s own finding still holds: nothing attaches a
     wire to an empty column, so this costs no wire geometry at any width. -->
{#snippet emptyTile(text: string)}
	<div class="hood-tile hood-tile--empty rounded-md border border-dashed border-line-strong p-3">
		<p class="t-meta text-fg-subtle">{text}</p>
	</div>
{/snippet}

{#snippet upstreamColumn(items: readonly UpItem[])}
	<div class="hood-list grid min-w-0 content-center">
		{#if items.length === 0}
			{@render emptyTile('Nothing gates this rollout')}
		{:else}
			{#each items as item (item.key)}
				{#if item.kind === 'gate'}
					{@render gateBox(item.box)}
				{:else}
					{@render linkBox(item.link)}
				{/if}
			{/each}
		{/if}
	</div>
{/snippet}

{#snippet downstreamColumn(links: readonly NeighbourLink[])}
	<div class="hood-list grid min-w-0 content-center">
		{#if links.length === 0}
			<!-- ⭐ "Nothing waits on this rollout", not "Gates nothing"
			     (squad-rollout Lane G round 5, AD ruling): "gates" as a bare
			     verb here read as a typo at a glance, next to "Gated by" (a
			     different grammatical role) on the other side of the canvas. -->
			{@render emptyTile('Nothing waits on this rollout')}
		{:else}
			{#each links as l (l.key)}
				{@render linkBox(l)}
			{/each}
		{/if}
	</div>
{/snippet}

{#if focus}
	<!-- ⭐ DESIGN LANGUAGE §3.18 (2026-10-09): graph surfaces draw on
	     `.canvas-dots` inside a `rounded-md border-line` frame, the same
	     ground `/dependencies`' own `DependencyNetwork` canvas draws on — so
	     the two graphs read as one object at two scales. This wraps the
	     existing `.hood` grid/SVG unchanged (no class or markup inside it
	     moved) rather than painting the dotted ground onto `.hood` itself,
	     which is also the wire math's own measurement root: the frame only
	     adds a padded backdrop one level out, so `root`'s rect — and every
	     wire computed from it — is exactly as before, just inset by this
	     frame's own padding. -->
	<!-- ⭐ THE CANVAS IS THE PAGE'S ONE HEAVY OBJECT (squad-rollout Lane G
	     round 2, item 3; round 4, item 6, AD ruling revised the numbers).
	     It used to be a graph squeezed into the top third of a 1100px
	     dotted frame with no floor on its own height — most of the card
	     beneath it was empty ground. 280px/32px padding (round 2's own
	     numbers) turned out to be TOO generous once the empty-column fix
	     (above) and the shorter round-4 tiles shrank the graph's own
	     content: a one-row approval hold was 280px tall with ~90px of bare
	     dots above and below it. `min-h-[160px]` + `p-6` (24px) is "content
	     + 24px padding, min 160" — the canvas now fits what it draws instead
	     of a fixed floor taller than most of what it holds. -->
	<div class="canvas-dots min-w-0 rounded-md border border-line p-3 sm:p-6 lg:flex lg:min-h-[160px] lg:items-center lg:p-6">
	<div bind:this={root} class="hood relative w-full" class:hood--steep={steep} role="group" aria-label="Gates of {focus.name} in {focus.env}">
		<div
			class="hood-grid"
			class:hood-grid--no-up={upstream.length === 0}
			class:hood-grid--no-down={downstream.length === 0}
		>
			<div class="hood-up min-w-0" class:hood-col--empty={upstream.length === 0}>
				<!-- ⭐ COLUMN HEADS AS `t-label` (squad-rollout Lane G round 2, item
				     3): "Gated by · N" / "This rollout" / "Downstream · N" — the label
				     role every other section head on this product uses (28px dot
				     headers, the palette's group heads), not a `t-ui-sm` line that
				     read at body-text weight. -->
				<p class="hood-label t-label text-fg-subtle">
					Gated by · <span class="tabular-nums">{gatedByCount}</span>{#if chainEnvNames.length}{' '}<span>+ {chainEnvNames.join(', ')}</span>{/if}
				</p>
				{@render upstreamColumn(upstream)}
			</div>

			<div class="hood-focus min-w-0">
				<p class="hood-label hood-label-focus t-label text-fg-subtle">This rollout</p>
				<!--
					⭐ INTEGRATOR HAND-OFF (a): THE BOX SIZES TO ITS OWN CONTENT NOW.
					It used to carry an inline `min-height` built from
					`focusMinHeight(slot count, pitch)` plus `justify-center`, so a
					short focus (no held build, one line of prose) was stretched to
					fit 5 incoming wire slots — measured ~29px of blank space above
					and below its own content on `checkout-api` staging at 1440. The
					box no longer takes that style at all: it is exactly as tall as
					its three lines. `measure()` reads this element's REAL rect, and
					`slots()` (unowned, unchanged) already anchors to a box's own
					centre and holds its pitch even when the box is shorter than the
					fan needs — which is "anchor the wire slots to it" with zero
					change to the wire geometry itself.
				-->
				<!-- ⭐ THE ONE RAISED OBJECT ON SCREEN, AND THE LARGEST (squad-rollout
				     Lane G round 2 item 3; round 4 item 3, AD ruling). Every other
				     tile on this canvas sits flat on `bg-surface`; the focus is the
				     one thing the reader's eye should land on first: `.surface-raised`
				     (one step lighter + the overlay shadow), `rounded-md` (the SAME
				     8px every gate tile uses — round 4 dropped the 12px `rounded-lg`
				     that made this a third radius on the canvas), glyph-led like
				     every other tile (`StatusMark`, native 16px), name THEN env chip
				     (the gate tiles' own anatomy — this used to lead with the chip).
				     One sans state line ("N builds wait here", not the mono "Held:
				     a, b +1 wait here" that used to wrap an orphan line) with the
				     actual build ids listed below it in `t-code-sm`. -->
				<div
					data-hood-focus
					use:holdHeight={focus?.id}
					class="surface-raised flex min-h-0 flex-col gap-1.5 rounded-md border p-4
						{focusHeldBuilds.length > 0 ? 'border-held-line' : 'border-line'}"
				>
					<span class="flex min-w-0 items-start gap-2.5">
						<!-- ⭐ 20px ON THE FOCUS, 16px ON EVERY GATE TILE (squad-rollout
						     Lane G round 5, item D, AD ruling): `StatusMark` itself is
						     frozen at 16px (shared, off-limits to edit) — a 1.25×
						     `scale()` wrapper on the ONE raised object keeps the focus
						     the largest mark on the canvas without a second glyph
						     component. -->
						<span class="mt-[1px] inline-flex h-5 w-5 shrink-0 items-center justify-center">
							<span style="transform: scale(1.25)"
								><StatusMark state={focusHeldBuilds.length > 0 ? 'held' : 'newest'} /></span
							>
						</span>
						<span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
							<span class="t-card-title min-w-0 break-words text-fg">{focus.name}</span>
							{#if themeOf(focus.env)}
								<Chip role="env" theme={themeOf(focus.env)} label={envLabel(focus.env)} title={focus.env} wide class="shrink-0" />
							{:else if focus.env}
								<span class="t-meta shrink-0 text-fg-subtle">{focus.env}</span>
							{/if}
						</span>
					</span>
					<p class="t-meta text-fg-subtle">
						{#if focus.build}runs <span class="t-code-lg text-fg">{focus.build}</span
							>{:else}never deployed{/if}
					</p>
					{#if focusHeldBuilds.length > 0}
						<!-- ⭐ DESIGN LANGUAGE §2.7 / SPEC §3 (2026-10-09), ONE SANS STATE
						     LINE (round 4, item 3): "Held" in held ink carries the fact
						     — never the uppercase filled "HELD HERE" chip (filled chips
						     are `STUCK`'s alone, §2.7, Chip.svelte §3.7) — as a plain
						     count sentence, not a mono line racing the build ids for
						     space. The ids themselves move to their own `t-code-sm` line
						     below, where they can wrap freely. Reads `focusHeldBuilds`
						     (see the prop's own doc comment) so it cannot contradict the
						     page's lead row. -->
						<!-- ⭐ qa11b, item 2 correction (squad-rollout gates-2 follow-up,
						     2026-10-11): "here", never "waits here" — `wait`/`waits` is
						     the verb reserved for a CHAIN-queued build
						     (`chainWaitsForText`'s own "Waits for `<stage>`"); a build
						     named in `focusHeldBuilds` is already refused HERE, which is
						     the opposite of waiting. -->
						<p class="t-meta text-held">
							<span class="text-held">Held:</span>
							{focusHeldBuilds.length}
							{focusHeldBuilds.length === 1 ? 'build' : 'builds'} here
						</p>
						<p class="t-code-sm min-w-0 break-words text-held">{focusHeldBuilds.join(', ')}</p>
					{:else if focusWaitsFor}
						<p class="t-meta text-fg-subtle">{focusWaitsFor}</p>
					{:else}
						<p class="t-meta text-fg-subtle">No build held here</p>
					{/if}
				</div>
			</div>

			<div class="hood-down min-w-0" class:hood-col--empty={downstream.length === 0}>
				<!-- batch4 #2 follow-up: "Downstream · N", not "Gates · N". These boxes
				     are other rollouts that wait on THIS one; they are not gates of
				     this rollout and are excluded from the "N of M gates holding"
				     count (`gatesOnThisRollout`), so the head must not call them
				     gates. Their held line reads "<build> held downstream": the
				     downstream place's own hold, never this rollout's gate. -->
				<p class="hood-label t-label text-fg-subtle">
					Downstream · <span class="tabular-nums">{hood.downstream.length}</span>
				</p>
				{@render downstreamColumn(downstream)}
			</div>
		</div>

		<svg
			class="pointer-events-none absolute inset-0 overflow-visible"
			width={box.w}
			height={box.h}
			aria-hidden="true"
		>
			<defs>
				{#each WIRE_KINDS as k (k)}
					<!-- One head spec for every dependency graph (`$lib/graph-arrow`):
					     fixed px, base on the path's end, tip on the edge. -->
					<marker
						id="{uid}-{k}"
						viewBox={ARROW_VIEWBOX}
						refX="0"
						refY="8"
						markerUnits="userSpaceOnUse"
						markerWidth={ARROW[k].length}
						markerHeight={ARROW[k].width}
						orient="auto"
					>
						<path d={ARROW_PATH} fill={ink(k)} />
					</marker>
				{/each}
			</defs>
			{#each wires as w (w.key)}
				{@const k = wireKind(w.state)}
				<path
					d={w.d}
					stroke={ink(k)}
					fill="none"
					stroke-width={ARROW[k].stroke}
					stroke-dasharray={w.state === 'unknown' ? `${DASH.on} ${DASH.off}` : undefined}
					use:endOnDash={w.state === 'unknown'}
					marker-end="url(#{uid}-{k})"
					data-wire={w.key}
					data-tip="{w.tip[0]},{w.tip[1]}"
				/>
			{/each}
		</svg>
	</div>
	</div>
{/if}

<style>
	/*
	 * NARROW FIRST: one column — each layer's label sits directly above its
	 * own boxes, the lists are indented 24px so the spine (x = 12) runs beside
	 * them, and the focus box spans the full width between them.
	 */
	.hood {
		container-type: inline-size;
	}
	.hood-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		row-gap: 12px;
	}
	.hood-label {
		margin-bottom: 8px;
	}
	/* ⭐ TIGHTER AT NARROW (squad-rollout Lane G round 6 nit, AD ruling: "the
	   focus tile's held line sits above the fold"). Round 6's own SPEC §7
	   addition (release sentence + action on every held tile) made each
	   tile 2 lines taller, which pushed the focus further down a phone's
	   first screen than before — the fix is vertical SAVINGS elsewhere, not
	   dropping the new content. 12px between stacked tiles at narrow (was
	   24px at every width); the wide, three-column layout keeps the full
	   24px gap (overridden back up inside the `@container` block below),
	   where there is no fold to protect. */
	.hood-list {
		gap: 12px;
	}
	.hood-label-focus {
		/* The focus box's own ring says "this one" on a phone; a label between
		   the spine and the box would cut the wire. */
		display: none;
	}
	/* 32 px: spine 12 + corner 6 + a 6 px straight stem + the 8 px head, so a
	   narrow wire's head lands on the box after a straight run. */
	.hood-up,
	.hood-down {
		padding-left: 32px;
	}

	/* ⭐ HIDE AN EMPTY COLUMN AT EVERY WIDTH (round 5 item 6 did this only at
	   ≥672px via the grid-template-columns override below; round 6 item 5,
	   AD ruling, extends it to 390 too — a dashed "Downstream · 0" placeholder
	   tile the narrow stack still drew, one `{#if}` branch nobody asked to
	   keep). Universal (outside the container query): nothing attaches a
	   wire to a hidden column (U-32(c)'s own finding, unaffected either way,
	   since `display: none` drops it from `measure()`'s own `querySelectorAll`
	   the same way the column simply not existing would). */
	.hood-grid--no-up .hood-up,
	.hood-grid--no-down .hood-down {
		display: none;
	}

	/*
	 * WIDE: three layers left → right, a 72px wire gutter between each.
	 *
	 * ⛔ ITEM 2 (2026-10-09, integration round 3, design re-review). Every
	 * layer used to be CENTRED on the row (`align-items: center`) — right in
	 * spirit ("a label always sits on its own boxes"), but centring means
	 * each column's vertical position depends on the TALLEST column's own
	 * height, so three columns with three different box counts (5 upstream,
	 * 1 focus, 5 downstream — `checkout-api`'s own Gates tab, live-measured)
	 * started their first box at three different y's: "Gated by"/"Gating"
	 * both opened at y≈275, "This rollout" at y≈446, 171px lower. A reader
	 * scanning left→right for "what gates this" lost the row.
	 *
	 * Top-aligning the row (`align-items: start`) fixes it directly: every
	 * column is exactly as tall as its own label+boxes, so each one's first
	 * box starts at the row's own top, regardless of a sibling's height — the
	 * same guarantee `.hood-col--empty`'s `align-self: start` already gave
	 * the empty-column case alone, now the row's own default. The one-line
	 * empty-column override right below is harmless but now redundant
	 * (inherits `start` from the row); left in place since it still
	 * documents that specific case's own reasoning. */
	@container (min-width: 672px) {
		.hood-list {
			/* Back to the full 24px at wide — no fold to protect here, and
			   the extra air reads better across a 400/480px-wide column. */
			gap: 24px;
		}
		.hood-grid {
			/* ⭐ CONTENT-SIZED TRACKS, NOT `fr` (round 6, items 2 and 3, AD
			   ruling: "ONE compact group, centred … each column label sits
			   flush on its tile's left edge … one width per column … left-
			   aligned"). `fr` tracks always consume 100% of the container —
			   at 1920 that stretched each side column to ~28% of the
			   viewport even after round 5 capped the TILE's own max-width,
			   because `justify-items: center` only recentred the tile INSIDE
			   an oversized track, so the track's own left edge (where the
			   column LABEL sits — it has no max-width) drifted away from the
			   now-narrower, centred tile below it. `minmax(0, 400px)` /
			   `minmax(0, 480px)` make the TRACK itself exactly as wide as its
			   own content needs, capped — the same two numbers the tiles
			   already use for their own `max-width` — so a column's track
			   and its tiles are the same width by construction, and the
			   label (printed directly in the track, no cap of its own) sits
			   flush on the SAME left edge the tile's own left edge is on.
			   `justify-content: center` (unchanged) now has real slack to
			   centre: three content-sized tracks summing to LESS than the
			   canvas width is "one compact group", with the dots filling
			   what is left on both sides. */
			grid-template-columns: minmax(0, 400px) 8rem minmax(0, 480px) 8rem minmax(0, 400px);
			align-items: start;
			justify-content: center;
		}
		/* A ONE-LINE "Nothing gates this rollout"/"Gates nothing" column, with
		   no box of its own to measure against — `align-self: start` (now the
		   row's own default too) keeps its sentence beside the FIRST box of
		   the opposite column rather than floating lower. */
		.hood-col--empty {
			align-self: start;
		}
		/* A steep fan (a rise over twice the gutter) gets a wider gutter, so
		   the S-curves stay shallow enough to read — still inside round 6's
		   120–160px fixed-gutter band (8rem base, 9rem steep). */
		.hood--steep .hood-grid {
			grid-template-columns: minmax(0, 400px) 9rem minmax(0, 480px) 9rem minmax(0, 400px);
		}
		.hood-up {
			grid-column: 1;
		}
		.hood-focus {
			grid-column: 3;
			/* ⭐ THE FOCUS IS CENTRED AGAINST THE GATED-BY STACK (round 4, item
			   3) — the row itself stays `align-items: start` (see the comment
			   above: that fixed a worse defect, ragged first-row starts when
			   columns hold different box counts), but the ONE column that is
			   the page's single focal object is allowed its own `align-self`
			   without reopening that fix for its neighbours. */
			align-self: center;
		}
		.hood-down {
			grid-column: 5;
		}
		.hood-label-focus {
			display: block;
		}
		.hood-up,
		.hood-down {
			padding-left: 0;
		}

		/* ⭐ DROP AN EMPTY COLUMN, CENTRE THE REST (round 4, item 6). The
		   empty side's track collapses to 0 (its `.hood-up`/`.hood-down` is
		   also `display: none`, see the universal rule above) and
		   `justify-content: center` (set above) re-centres the remaining
		   one or two columns in the canvas. */
		.hood-grid--no-up {
			grid-template-columns: 0 0 minmax(0, 480px) 8rem minmax(0, 400px);
		}
		.hood-grid--no-down {
			grid-template-columns: minmax(0, 400px) 8rem minmax(0, 480px) 0 0;
		}
		.hood-grid--no-up.hood-grid--no-down {
			grid-template-columns: minmax(0, 480px);
		}
	}

	/* ⭐ THE SERVICE TILE'S OWN MIN-WIDTH (squad-rollout Lane G round 2, item
	   3): 240px at the three-column WIDE layout, where each column has the
	   room — a plain Tailwind `min-w-[240px]` on the tile itself would also
	   apply in the NARROW single-column stack, where the column can be
	   narrower than that on a 360px phone. Scoped to the same 672px
	   container query as the three-column grid above, so a tile never forces
	   its own column wider than the phone it is on.

	   ⭐ AND A MAX-WIDTH, 400px (round 5, item C). `.hood-list`'s own
	   DEFAULT `justify-items: stretch` (round 6 dropped the `center`
	   override that used to live here) is what gives a column "one width
	   per column — the widest tile's content, capped at 400" (round 6, item
	   3): every tile in the same list STRETCHES to the list's own one
	   computed column width (the widest tile's natural size, ceilinged by
	   this `max-width`), so two tiles of different natural lengths in the
	   same "Gated by" column still share one edge-to-edge width — never a
	   second, independent centring step. The OUTER `.hood-grid` track is
	   now content-sized too (see that rule's own comment), so this list's
	   own natural width already starts flush at the track's left edge; no
	   further centring is needed at this level. Wires are computed from
	   real DOM rects (`measure()`), so capping a tile's width only moves
	   where its rect IS — verified at 1440 and 1920. */
	.hood-tile {
		min-width: 0;
	}
	@container (min-width: 672px) {
		.hood-tile {
			min-width: 240px;
			max-width: 400px;
		}
		/* The focus tile is not `.hood-tile` (it is the canvas's one raised
		   object, not a service tile) — capped at 480px (≈1.2× the 400px gate
		   tiles), same reasoning. */
		[data-hood-focus] {
			max-width: 480px;
		}
	}
</style>
