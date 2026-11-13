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
	import {
		BanOutline,
		CalendarWeekOutline,
		ChevronDoubleRightOutline,
		HeartOutline,
		LockOutline,
		QuestionCircleOutline,
		ShareNodesOutline,
		ShieldCheckOutline,
		UserCircleOutline
	} from 'flowbite-svelte-icons';
	import Avatar from '$lib/components/Avatar.svelte';
	import { windowBar } from '$lib/view-models/window-bar';
	import { CLEAR_PIN_LABEL } from './pin-copy';
	import { stateWord } from '$lib/components/new/state-words';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import { StableOrder, RetainedRows } from '$lib/view-models/stable-order';
	import { holdHeight } from '$lib/smooth-height';
	import { shortEnvLabel, type EnvironmentTheme } from '$lib/environment-theme';
	import type { GraphNode } from '$lib/view-models/dependency-graph';
	import type { NeighbourLink, RolloutNeighbourhood } from '$lib/view-models/rollout-neighbourhood';
	import { withoutSupersededBoxes, type GateBox } from '$lib/view-models/rollout-gates';
	import GateLabel from './GateLabel.svelte';
	import type { GateLabel as GateLabelT } from '$lib/view-models/gate-label';
	import CauseText from './CauseText.svelte';
	import type { Cause } from '$lib/view-models/gate-label';
	import ApproveButton from '$lib/components/new/ApproveButton.svelte';
	import { ForwardStepOutline } from 'flowbite-svelte-icons';
	import type { SkipTarget } from '$lib/view-models/skip-rule';

	/** What a tile says about skipping its rule once (see the `skipState` prop). */
	type SkipTileState = { kind: 'pending'; build: string; waitsFor: string[] } | { kind: 'offer'; target: SkipTarget };
	import { approvalWord, ASK_LOADING } from '$lib/components/new/state-words';
	import { fade } from 'svelte/transition';
	import type { ApprovalTarget } from '$lib/components/new/data';
	import { now } from '$lib/stores/time';
	import { WIRE_DASH, WIRE_STROKE, WIRE_TONE_CLASS, wireDashOffset, wireTone } from '$lib/graph-wire';
	import {
		wideWires,
		compactWires,
		headsOf,
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
		skipState = null,
		onSkipRule = null,
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
		/**
		 * ⭐ SKIP ONCE (bypass-only): what an UPSTREAM tile says about skipping its rule for one build. `gateNames` are the RolloutGates behind the
		 * tile, `label` the rule as the tile names it. `pending`: a skip is asked for and not yet used (drawn as a line, no button, whoever is
		 * looking). `offer`: the rule holds a build and the viewer may skip it (the button; only drawn when `onSkipRule` is set). Null: nothing.
		 */
		skipState?: ((gateNames: string[], label: string) => SkipTileState | null) | null;
		/** The Skip once button's action: opens the dialog for this target. Null draws no button (no permission, or permission still loading). */
		onSkipRule?: ((t: SkipTarget) => void) | null;
		/** The approval the viewer can give at this rollout (data.ts `approvalAskAt`, the one Home offers): the held approval gate says "Needs your approval" and carries Approve instead of "How to approve". Null: today's words. */
		approveAsk?: ApprovalTarget | typeof ASK_LOADING | null;
		/** The builds this place's approval gate has been given an approval for, as the place's own RolloutApprovals say it (`approvedFactOf`): "c0d3e88 · approved by wyatt" under the approval gate, held or not, so an approved build never reads as merely not held. */
		approvedFacts?: { build: string; text: string; title: string; who?: string }[];
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

	/** Same threshold the grid's container query uses (960px; #140 set 800, the compact graph now takes 560-959): below it the layers stack and the wires take the narrow spine. */
	const WIDE_AT = 960;
	/** The compact graph (two columns, downstream under the focus) from 560px of container up to WIDE_AT; the stacked list below it. */
	const COMPACT_AT = 560;

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
	/* AD r1 #9 + r2 #4: the head is a count only, of GATES, the same number the card's "N of M gates holding" says; the stage before
	   this one (its » tile is a promotion, not a gate) is named in the head's tooltip. */
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
	function chainLine(l: NeighbourLink): Cause | null {
		if (chainWait) {
			const first = upstreamLinks.find((x) => x.chainPredecessor);
			const named = upstreamLinks.some((x) => x.chainPredecessor && x.node.env === chainWait.stage);
			if (named ? l.node.env === chainWait.stage : l === first) return [chainWait.text];
		}
		const peer = peerHeldByEnv?.get(l.node.env);
		// The raw env name, same convention `waitsFor`/the "Newer builds"
		// rows already print ("Waits for staging"), never the Chip's own
		// abbreviated label.
		// <= 5 words (AD r1 #3): the stage is the tile's own chip, so the line names only what that stage is held on.
		if (peer?.held && peer.causeLabel) return [`Waits on ${peer.causeLabel}`];
		// A peer still checking / deploying / failing its own build has NOT passed: it reads the place verdict word the app page and /rollouts print.
		const word = peerWord(l);
		if (word) return [word];
		// Reaching here means the predecessor holds nothing (no chain wait, no held peer): the build already passed it. The tile says
		// nothing more (Gatehouse: a passing tile states nothing about holding; its type is the header's » Promotion).
		return null;
	}

	/** batch4 #76: the Gates tab of a promotion label's source environment, when the upstream column has that environment's rollout; else no link. */
	function sourceGatesHref(label: GateLabelT): string | null {
		if (label.kind !== 'promotion' || !label.source) return null;
		const l = upstreamLinks.find((x) => x.node.env === label.source);
		return l ? hrefOf(l.node) : null;
	}

	/**
	 * ⭐ THE TILE'S TYPE (Gatehouse, 2026-11-12). One glyph and one word per kind of gate, from `gateMark`'s own family (`GateRecord.svelte`):
	 * the same object draws the same mark on the Overview's gate rows, the banner record and here. Never a hue: the type is the glyph + word,
	 * the colour is the state's.
	 */
	type TileType = 'promotion' | 'dependency' | 'approval' | 'window' | 'freeze' | 'check' | 'gate' | 'health' | 'pin';
	type MarkState = 'held' | 'newest' | 'checking' | 'deploying' | 'failed' | 'behind';
	const TYPES: Record<TileType, { icon: typeof ShieldCheckOutline; word: string }> = {
		promotion: { icon: ChevronDoubleRightOutline, word: 'Promotion' },
		dependency: { icon: ShareNodesOutline, word: 'Dependency' },
		approval: { icon: UserCircleOutline, word: 'Approval' },
		window: { icon: CalendarWeekOutline, word: 'Deploy window' },
		freeze: { icon: BanOutline, word: 'Freeze' },
		check: { icon: ShieldCheckOutline, word: 'Check' },
		gate: { icon: QuestionCircleOutline, word: 'Gate' },
		health: { icon: HeartOutline, word: 'Health' },
		pin: { icon: LockOutline, word: 'Pin' }
	};
	const linkType = (l: NeighbourLink): TileType => (l.writer === 'contract' ? 'dependency' : 'promotion');
	function boxType(b: GateBox): TileType {
		if (b.label?.kind === 'promotion') return 'promotion';
		if (b.kind === 'approval' || b.mark.clears === 'person') return 'approval';
		if (b.kind === 'freeze' || b.window?.action === 'Deny') return 'freeze';
		if (b.kind === 'schedule' || b.mark.clears === 'clock') return 'window';
		if (b.kind === 'health') return 'health';
		if (b.kind === 'pin') return 'pin';
		return b.mark.kind === 'unknown' ? 'gate' : 'check';
	}

	/**
	 * ⭐ THE RELEASE LINE, ONE SHORT CLAUSE (owner 2026-11-12: "too much text"). SPEC §7's "every holding tile states its release" stays, in
	 * the fewest words that still name the condition: the env and build that must move first, or the version the provider must reach. The
	 * held builds are named once, on the focus tile; the provider's name once, on its own tile.
	 */
	function linkReleaseLine(l: NeighbourLink): string {
		if (l.side === 'downstream' && focus) {
			if (l.writer === 'contract') return `After ${focus.name} ships ${l.requiredVersion ?? 'a newer version'}`;
			return `After ${envLabel(focus.env)} deploys ${l.held[0] ?? 'its first build'}`;
		}
		if (l.writer === 'contract') {
			const need = l.requiredVersions?.[0] ?? l.requiredVersion;
			return need ? `Needs ${need}` : 'Needs a newer version';
		}
		return l.held[0] ? `After ${envLabel(l.node.env)} deploys ${l.held[0]}` : `After ${envLabel(l.node.env)} deploys first`;
	}

	/** A held gate box's clause: what lets the build through, by kind (`b.mark.clears`, the product's one-per-kind read). */
	function boxReleaseLine(b: GateBox): string {
		if (b.mark.clears === 'pin') return 'Until the pin is cleared';
		if (b.phrase) return b.phrase.charAt(0).toUpperCase() + b.phrase.slice(1);
		return 'Not passing';
	}

	/** The window's state in words, the controller's own `status.active` (never the bar's arithmetic): "Open · closes Fri 18:00 CEST". */
	function windowLine(b: GateBox): string {
		const w = b.window;
		if (!w) return b.phrase.charAt(0).toUpperCase() + b.phrase.slice(1);
		if (w.action === 'Deny') return w.active ? (w.when ? `Frozen · until ${w.when}` : 'Frozen') : w.when ? `Starts ${w.when}` : 'Not in effect';
		return w.active ? (w.when ? `Open · closes ${w.when}` : 'Open') : w.when ? `Closed · opens ${w.when}` : 'Closed';
	}

	/** The hours a window is shut today (the complement of its allowed spans), for a holding window's held-ink span. */
	function closedSpans(allowed: [number, number][]): [number, number][] {
		const out: [number, number][] = [];
		let at = 0;
		for (const [a, z] of allowed) {
			if (a > at) out.push([at, a]);
			at = Math.max(at, z);
		}
		if (at < 1) out.push([at, 1]);
		return out;
	}

	/** The bar's tooltip: the rules as written, in the schedule's own zone (a rule is not an instant, so it keeps the spec's zone). */
	function windowRulesTitle(b: GateBox): string {
		const w = b.window;
		if (!w?.rules?.length) return '';
		const verb = w.action === 'Deny' ? 'Frozen' : 'Allowed';
		const rules = w.rules.map((r) => {
			const days = r.daysOfWeek?.length ? r.daysOfWeek.map((d) => d.slice(0, 3)).join(', ') : 'every day';
			const time = r.timeRange ? `${r.timeRange.start ?? '00:00'}–${r.timeRange.end ?? '24:00'}` : 'all day';
			const dates = r.dateRange ? ` (${(r.dateRange.start ?? '').slice(0, 10)} to ${(r.dateRange.end ?? '').slice(0, 10)})` : '';
			return `${days} ${time}${dates}`;
		});
		return `${verb} ${rules.join('; ')} ${w.timezone || 'UTC'}`;
	}

	/** The tile's tooltip: what it holds, and the Kubernetes names behind it (never printed). */
	function boxTitle(b: GateBox): string | undefined {
		const parts = [b.held.length ? `Holding ${b.held.join(', ')}` : '', b.gates.join(', ')].filter(Boolean);
		return parts.length ? parts.join(' · ') : undefined;
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
		/** A box's PORT: the centre of its title row (`data-hood-port`), so a box that grows a second line keeps it. */
		const portOf = (el: Element) => {
			const p = el.querySelector('[data-hood-port]');
			if (!p) return undefined;
			const pr = local(p);
			return pr.top + pr.height / 2;
		};
		const f = { ...local(focusEl), port: portOf(focusEl) };
		const read = (side: 'upstream' | 'downstream'): WireIn[] =>
			[...root!.querySelectorAll<HTMLElement>(`[data-hood-link="${side}"]`)].map((el, i) => ({
				key: el.dataset.key ?? `${side}-${i}`,
				state: (el.dataset.wireState ?? el.dataset.state ?? 'clear') as WireIn['state'],
				rect: local(el),
				port: portOf(el)
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
		} else if (width >= COMPACT_AT) {
			wires = compactWires(f, up, down);
		} else {
			wires = narrowWires(f, up, down);
		}
	}

	/** Ends a dashed (unread) wire on a dash, so its head sits on ink. */
	function endOnDash(node: SVGPathElement, dashed: boolean) {
		const apply = (on: boolean) => {
			if (!on) return node.removeAttribute('stroke-dashoffset');
			const len = typeof node.getTotalLength === 'function' ? node.getTotalLength() : 0;
			node.setAttribute('stroke-dashoffset', String(wireDashOffset(len)));
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

	/** The window bar's clock: whole minutes, so the now tick moves on its own once a minute (QA #141) without re-rendering every 100ms. */
	const minute = $derived(Math.floor($now.getTime() / 60_000));

</script>

<!--
	⭐ THE GATEHOUSE TILE (2026-11-12, owner: "a bit too much text … the gates and their types could be a lot clearer and have their own
	visuals / styling"; AD round 1: type in the body's shape, no label strip). ROLE: every box on this canvas, one anatomy —
	  1. ONE ROW, 28px tall inside 12px padding (52px tile): the type's own 16px glyph (`gateMark`'s family) leads, the identity in the
	     type's own form follows, the type's own right-hand object (a build for a promotion or dependency, the approver's avatar or
	     Approve for an approval, today's 24h bar for a window), and the 16px state mark ends the row. Every passing tile is this one row.
	  2. only while it holds (or, quiet, while it waits on another stage): one short line under the identity, <= 5 words.
	An approval never grows a second line: Approve, "You can't approve" and the approver's avatar take turns in one slot (coordinator,
	binding: same height pending and approved). Type is glyph + body shape, never a hue: colour stays the state's. Reference: GitHub's
	required-checks list and Vercel's deployment checks (an identity mark per check type, one status mark per row, detail one click away).
-->
{#snippet glyph(type: TileType)}
	{@const T = TYPES[type]}
	<T.icon class="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" /><span class="sr-only">{T.word}:</span>
{/snippet}

{#snippet mark(state: MarkState)}
	<span class="inline-flex shrink-0" data-gate-mark={state}><StatusMark {state} /></span>
{/snippet}

<!-- ⭐ SKIP ONCE, THE TILE'S TWO PARTS (bypass-only spec §1, §4). New by design: no existing state means "armed, not fired". Pending: the tile's own held
     line (same slot, same `t-meta`), neutral ink, a 12px glyph; the tile border and mark stay as the controller says (the rule still holds every other
     build). The button is the pin tile's `Clear pin` slot and shape. -->
{#snippet skipPending(sk: Extract<SkipTileState, { kind: 'pending' }>)}
	<span class="inline-flex min-w-0 items-center gap-1.5" data-skip-pending>
		<ForwardStepOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
		<span class="min-w-0 break-words"
			>Skipped once for <span class="t-code-sm">{sk.build}</span
			>{#if sk.waitsFor.length > 0}<span class="text-fg-subtle ml-1">· waits for {sk.waitsFor.join(', ')}</span>{/if}</span
		>
	</span>
{/snippet}

{#snippet skipButton(t: SkipTarget, kind: 'secondary' | 'ghost' = 'secondary')}
	<button type="button" class="btn btn-xs btn-{kind} hit-32 shrink-0 max-sm:min-h-11 max-sm:px-3.5 max-sm:text-sm" data-skip-rule onclick={() => onSkipRule?.(t)}>
		<ForwardStepOutline class="h-4 w-4" aria-hidden="true" />Skip once
	</button>
{/snippet}

{#snippet linkBox(l: NeighbourLink)}
	{@const theme = themeOf(l.node.env)}
	{@const href = l.node.unresolved ? null : hrefOf(l.node)}
	<!-- A CHAIN PREDECESSOR IS NEVER DRAWN HELD (qa11): `l.chainPredecessor`, never `l.state`, decides. A DOWNSTREAM tile is never drawn held
	     either: it waits on THIS rollout, it does not hold it, so the column's held marks count exactly what holds this build (AD r1 #10). -->
	{@const waiting = l.state === 'blocked' && (l.chainPredecessor || l.side === 'downstream')}
	{@const held = l.state === 'blocked' && !waiting}
	{@const type = linkType(l)}
	{@const sameApp = type === 'promotion' && l.node.name === focus?.name}
	{@const chain = l.chainPredecessor ? chainLine(l) : null}
	{@const line = chain ?? (waiting || held ? [linkReleaseLine(l)] : null)}
	{@const quiet = !held}
	{@const sk = l.side === 'upstream' && l.gate && (held || waiting)
		? (skipState?.([l.gate], type === 'promotion' ? `Promotion from ${l.node.env}` : `${l.node.name} dependency`) ?? null)
		: null}
	{@const offer = sk?.kind === 'offer' && onSkipRule ? sk.target : null}
	<!-- A button cannot nest in an <a>: a tile that carries Skip once is a div, its identity is the `.tap-link` whose overlay still makes the whole tile navigate. -->
	{@const stretch = !!offer && !!href}
	<svelte:element
		this={href && !stretch ? 'a' : 'div'}
		href={stretch ? undefined : href}
		data-hood-link={l.side}
		use:holdHeight={focus?.id}
		data-state={l.state}
		data-wire-state={waiting ? 'clear' : l.state}
		data-key={l.key}
		data-gate-type={type}
		title={href ? `Open ${l.node.name} in ${l.node.env}${l.node.build ? ` (runs ${l.node.build})` : ''}` : l.node.unresolved ? `${l.node.name} in ${l.node.env} is not in this dashboard` : undefined}
		class="hood-tile gh-tile flex min-w-0 flex-col gap-1 rounded-md border p-3 transition-[border-color]
			focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]
			{held
			? 'border-held-line bg-surface'
			: l.node.unresolved
				? 'border-dashed border-line-strong bg-subtle'
				: 'border-line bg-surface'}
			{href ? 'hover:border-line-strong' : ''} {stretch ? 'tap-zone' : ''}"
	>
		<span class="gh-row flex min-w-0 items-center gap-2" data-hood-port>
			{@render glyph(type)}
			<!-- identity in the type's own shape: a promotion IS an environment (the env chip alone: the app is the focus's own name and the
			     build that env runs is one click away); a dependency is the other app and the version it runs (its environment in the tooltip:
			     one chip form on the canvas, the env badge belongs to a promotion). -->
			<svelte:element this={stretch ? 'a' : 'span'} href={stretch ? href : undefined} class="{stretch ? 'tap-link ' : ''}flex min-w-0 flex-1 items-center gap-2">
				{#if !sameApp}<span class="gh-name t-card-title text-fg">{l.node.name}</span>{/if}
				{#if sameApp && theme}
					<Chip role="env" {theme} label={envLabel(l.node.env)} title={l.node.env} class="min-w-0" />
				{:else if sameApp}
					<span class="t-meta min-w-0 truncate text-fg-subtle">{l.node.env}</span>
				{/if}
			</svelte:element>
			{#if sameApp}
				<!-- no right-hand object: the chip is the promotion's drawing -->
			{:else if l.node.build}
				<span class="t-code-sm shrink-0 text-fg-muted tabular-nums" data-gate-version>{l.node.build}</span>
			{:else if l.node.unresolved}
				<span class="t-meta shrink-0 text-fg-subtle" data-gate-version>not visible</span>
			{/if}
			{@render mark(waiting ? 'behind' : l.chainPredecessor ? (chainMark(l) === 'held' ? 'behind' : chainMark(l)) : markState(l.state))}
		</span>
		{#if sk?.kind === 'pending'}
			<p class="gh-line t-meta min-w-0 text-fg-muted" data-gate-release>{@render skipPending(sk)}</p>
		{:else if line}
			<p class="gh-line t-meta min-w-0 break-words {quiet ? 'text-fg-muted' : 'text-held'}" data-gate-release><CauseText parts={line} /></p>
		{/if}
		{#if offer}
			<div class="gh-line mt-1 self-start">{@render skipButton(offer)}</div>
		{/if}
	</svelte:element>
{/snippet}

{#snippet gateBox(b: GateBox)}
	{@const held = b.state === 'blocked'}
	{@const type = boxType(b)}
	{@const isApproval = type === 'approval'}
	<!-- With no approve permission a held approval says so in its slot, and the tile links to how approvals work. -->
	{@const askRaw = held && isApproval ? approveAsk : null}
	{@const loading = askRaw === ASK_LOADING}
	{@const ask = askRaw && askRaw !== ASK_LOADING ? askRaw : null}
	{@const docsHref = held && isApproval && !ask && !loading ? 'https://docs.kuberik.com/concepts/gates#approvals' : null}
	{@const bar = type === 'window' || type === 'freeze' ? windowBar(b.window, new Date(minute * 60_000)) : null}
	{@const fact = isApproval && !held ? approvedFacts.find((f) => f.who) ?? approvedFacts[0] : undefined}
	<!-- Skip once: schedule / freeze / approval / hand-written gate tiles only (never the pin, never health: not a rule). -->
	{@const sk = held && b.gates.length > 0 && b.kind !== 'pin' && b.kind !== 'health' ? (skipState?.(b.gates, b.title) ?? null) : null}
	{@const offer = sk?.kind === 'offer' && onSkipRule ? sk.target : null}
	<svelte:element
		this={docsHref ? 'a' : 'div'}
		href={docsHref}
		target={docsHref ? '_blank' : undefined}
		rel={docsHref ? 'noreferrer' : undefined}
		data-hood-link="upstream"
		use:holdHeight={focus?.id}
		data-state={b.state}
		data-key={`gate:${b.key}`}
		data-gate-type={type}
		title={docsHref ? 'How to approve a held build' : type === 'window' || type === 'freeze' ? [windowLine(b), windowRulesTitle(b)].filter(Boolean).join(' · ') : boxTitle(b)}
		class="hood-tile gh-tile flex min-w-0 flex-col gap-1 rounded-md border p-3 transition-[border-color]
			{held ? 'border-held-line bg-surface' : 'border-line bg-surface'}
			{docsHref ? 'hover:border-line-strong' : ''}"
	>
		<span class="gh-row flex min-w-0 items-center gap-2" data-hood-port data-approval-row={isApproval ? '' : undefined}>
			{@render glyph(type)}
			<span class="gh-name t-card-title flex-1 text-fg"
				>{#if b.label}<GateLabel label={b.label} glyph={false} href={docsHref ? null : sourceGatesHref(b.label)} />{:else}{b.title}{/if}</span
			>
			{#if bar}
				<!-- TODAY'S WINDOW, DRAWN: a 24h track in the schedule's own zone, quarter-day ticks, the allowed hours filled neutral, one quiet
				     now tick. The words ("Open · closes 17:00") live in the tooltip while it passes and on the held line while it holds. -->
				<span class="gh-bar" aria-hidden="true" data-window-bar>
					{#each bar.allowed as [a, z], i (i)}<span class="gh-bar-open" style="left:{a * 100}%;width:{(z - a) * 100}%"></span>{/each}
					<!-- holding: the shut hours are what holds the build, so they take held ink (AD r2 #3: an empty track read as "nothing scheduled") -->
					{#if held}{#each closedSpans(bar.allowed) as [a, z], i (i)}<span class="gh-bar-shut" style="left:{a * 100}%;width:{(z - a) * 100}%"></span>{/each}{/if}
					{#if bar.now !== null}<span class="gh-bar-now {held ? 'gh-bar-now--held' : ''}" style="left:{bar.now * 100}%" data-window-now></span>{/if}
				</span>
			{:else if isApproval}
				<!-- ⭐ ONE SLOT, ALWAYS (coordinator, binding: the approval tile keeps one height pending and approved). Approve, the reserved
				     box while the fleet answers, "You can't approve" and the approver's avatar replace each other in place. -->
				{#if held && !ask && !loading}
					<span class="gh-slot" title="You can't approve this build here" data-approve-none></span>
				{:else if held}
					<!-- the same empty approver slot while the viewer can approve (AD r3 #6: one row 1 in every approval state) -->
					<span class="gh-slot" title="Waiting for your approval" data-approve-yours></span>
				{:else if fact?.who}
					<span class="inline-flex shrink-0" title={approvedFacts.map((f) => `${f.build}: ${f.title}`).join('\n')} data-approved-build={fact.build}
						><Avatar name={fact.who} size={20} /></span
					>
				{/if}
			{/if}
			{@render mark(markState(b.state))}
		</span>
		{#if isApproval}
			<!-- ⭐ THE APPROVAL'S SECOND ROW, IN EVERY STATE (AD r2 #1 + coordinator, binding: one height pending and approved). Held: what
			     releases it, held ink, and Approve when the viewer can. Passing: who released it, quiet. The tile is 84px whatever happens. -->
			<!-- The action row is 28px in every state, so Approve (its label can be long: "Approve all 5 regions") never squeezes the gate's
			     name on the row above, and swapping it for "Approved by …" moves nothing. -->
			<span class="gh-line flex h-7 min-w-0 items-center gap-2">
				{#if sk?.kind === 'pending'}
					<span class="t-meta min-w-0 flex-1 truncate text-fg-muted" data-gate-release>{@render skipPending(sk)}</span>
				{:else}
					<span class="t-meta min-w-0 flex-1 truncate {held ? 'text-held' : 'text-fg-muted'}" data-gate-release
						>{#if held}{ask ? 'Needs you' : 'Needs approval'}{:else if fact}{fact.text.charAt(0).toUpperCase() + fact.text.slice(1)}{:else}Approved{/if}</span
					>
				{/if}
				{#if offer}{@render skipButton(offer, held && ask ? 'ghost' : 'secondary')}{/if}
				{#if held && ask}
					<span class="shrink-0" in:fade={{ duration: 150 }}><ApproveButton target={ask} class="btn btn-primary btn-xs" scope /></span>
				{:else if held && loading}
					<span class="inline-block h-7 w-[72px] shrink-0" aria-hidden="true" data-approve-slot></span>
				{/if}
			</span>
		{:else if held}
			{#if sk?.kind === 'pending'}
				<p class="gh-line t-meta min-w-0 text-fg-muted" data-gate-release>{@render skipPending(sk)}</p>
			{:else}
				<p class="gh-line t-meta min-w-0 break-words text-held" data-gate-release>{type === 'window' || type === 'freeze' ? windowLine(b) : boxReleaseLine(b)}</p>
			{/if}
			{#if b.kind === 'pin' && onClearPin}
				<button type="button" class="gh-line btn btn-xs btn-secondary mt-1 self-start" disabled={clearPinDisabled} onclick={onClearPin}>{CLEAR_PIN_LABEL}</button>
			{/if}
			{#if offer}
				<div class="gh-line mt-1 self-start">{@render skipButton(offer)}</div>
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
	<div class="canvas-dots min-w-0 rounded-md border border-line p-2 sm:p-6 lg:flex lg:min-h-[160px] lg:items-center lg:p-6">
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
					<span title={chainEnvNames.length ? `${gatedByCount} ${gatedByCount === 1 ? 'gate' : 'gates'}, after ${chainEnvNames.join(', ')}` : undefined}>Gated by · <span class="tabular-nums">{gatedByCount}</span></span>
				</p>
				{@render upstreamColumn(upstream)}
			</div>

			<div class="hood-focus min-w-0">
				<!-- AD r2: the raised focus tile names itself; the column head is for screen readers only (owner: less text). -->
				<p class="sr-only">This rollout</p>
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
					class="surface-raised flex min-h-0 flex-col gap-1 rounded-md border p-4
						{focusHeldBuilds.length > 0 ? 'border-held-line' : 'border-line'}"
				>
					<span class="flex min-w-0 items-start gap-2">
						<!-- ⭐ 20px ON THE FOCUS, 16px ON EVERY GATE TILE (squad-rollout
						     Lane G round 5, item D, AD ruling): `StatusMark` itself is
						     frozen at 16px (shared, off-limits to edit) — a 1.25×
						     `scale()` wrapper on the ONE raised object keeps the focus
						     the largest mark on the canvas without a second glyph
						     component. -->
						<span class="inline-flex h-5 w-5 shrink-0 items-center justify-center" data-hood-port>
							<span style="transform: scale(1.25)"
								><StatusMark state={focusHeldBuilds.length > 0 ? 'held' : 'newest'} /></span
							>
						</span>
						<!-- ONE SHAPE AT EVERY WIDTH (AD r3 #2): the name, then the env chip on its own line under it, always, so the centrepiece
						     never reflows between laptop widths (it used to wrap the chip under the name only below ~1440) and the chip is never cut. -->
						<span class="flex min-w-0 flex-1 flex-col items-start gap-1">
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
					<!-- ⭐ ONE HELD LINE (Gatehouse, 2026-11-12): the builds held here, named once on the canvas — "4.46.0-46 held here", no "Held: N
					     builds here" sentence above a second list of the same ids. Calm says nothing ("No build held here" was a sentence about nothing). -->
					{#if focusHeldBuilds.length > 0}
						<p class="t-meta min-w-0 break-words text-held" data-focus-held title={focusHeldBuilds.join(', ')}>
							{#each shortList(focusHeldBuilds).split(', ') as id, i (i)}{#if i > 0},{' '}{/if}<span class="t-code-sm whitespace-nowrap">{id}</span>{/each} <span class="whitespace-nowrap">held here</span>
						</p>
					{:else if focusWaitsFor}
						<p class="t-meta text-fg-subtle">{focusWaitsFor}</p>
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
			<!-- ⭐ THE CONNECTOR (`$lib/graph-wire`): 1 px hairlines in the `wire` token, `held-solid` only for a wire that carries a hold;
			     orthogonal runs with the tiles' 8 px corners from title-row port to title-row port; an open 1 px chevron at the tip.
			     Wires into the focus share one trunk and one tip, so they never cross; held paints last, so on a shared run it is the
			     one you see. One width for every state: a state change recolours a wire, it never moves one. -->
			{#each wires as w (w.key)}
				{@const tone = wireTone(w.state)}
				<!-- Butt caps on a dashed wire: round caps grow each 3 px dash to 4 and push the last one past the tip. -->
				<g class={WIRE_TONE_CLASS[tone]} fill="none" stroke-width={WIRE_STROKE}
					stroke-linecap={w.state === 'unknown' ? 'butt' : 'round'} stroke-linejoin="round"
					data-wire={w.key} data-wire-tone={tone}>
					<path
						d={w.d}
						stroke-dasharray={w.state === 'unknown' ? `${WIRE_DASH.on} ${WIRE_DASH.off}` : undefined}
						use:endOnDash={w.state === 'unknown'}
						data-tip="{w.tip[0]},{w.tip[1]}"
					/>
				</g>
			{/each}
			{#each headsOf(wires) as h (h.key)}
				<path d={h.d} class={WIRE_TONE_CLASS[h.tone]} fill="none" stroke-width={WIRE_STROKE} stroke-linecap="round"
					stroke-linejoin="round" data-wire-head data-wire-tone={h.tone} />
			{/each}
		</svg>
	</div>
	</div>
{/if}

<style>
	/*
	 * NARROW FIRST: one column — each layer's label sits directly above its
	 * own boxes, the lists are indented 20px so the spine (x = 4) runs beside
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
	/* 20 px: spine 4 + corner 6 + a 2 px straight stem + the 8 px head, so a
	   narrow wire's head lands on the box after a straight run (AD r1 #9, r2 #7:
	   the phone's gutter was 14%, then 11% of the frame). */
	.hood-up,
	.hood-down {
		padding-left: 20px;
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

	/* ⭐ COMPACT GRAPH, 560-959px OF CONTAINER (owner 2026-11-12, on the landing film's 1000px frame: "the nodes can be scaled down a
	   bit to fit … on mobile we show it basically as a list (that i would keep)"). Between the stacked list and the full three columns the
	   graph keeps its form at a smaller footprint: two columns — "Gated by" on the left, the focus on the right with the downstream column
	   UNDER it — one fluid 48-64px gutter, tiles about 250-370px wide, so nothing is cut and no name breaks mid-word. The right column is
	   centred against the left by two 1fr rows (the left column spans all four). Wires: `compactWires`. */
	@container (min-width: 560px) and (max-width: 959.98px) {
		.hood-grid {
			--hood-gutter-compact: clamp(3rem, 8cqi, 4rem);
			grid-template-columns: minmax(0, 400px) var(--hood-gutter-compact) minmax(0, 400px);
			grid-template-rows: 1fr auto auto 1fr;
			row-gap: 0;
			justify-content: center;
		}
		.hood-up {
			grid-column: 1;
			grid-row: 1 / -1;
			padding-left: 0;
		}
		.hood-focus {
			grid-column: 3;
			grid-row: 2;
		}
		.hood-down {
			grid-column: 3;
			grid-row: 3;
			margin-top: 16px;
			padding-left: 28px;
		}
		.hood-grid--no-up {
			grid-template-columns: minmax(0, 400px);
		}
		.hood-grid--no-up .hood-focus,
		.hood-grid--no-up .hood-down {
			grid-column: 1;
		}
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
	@container (min-width: 960px) {
		/* THE GUTTERS SHRINK WITH THE CONTAINER (2026-11-12). Fixed 8/9rem
		   gutters plus a 240px tile floor summed to 878px inside an 812px
		   container, and the section's `overflow-hidden` sliced the downstream
		   card. Gutters are now fluid, so they give back space first; the tile
		   floor only applies once the container can afford it (`.hood-tile`
		   block below). */
		.hood-grid {
			--hood-gutter: clamp(5rem, 12cqi, 8rem);
			--hood-gutter-steep: clamp(5.5rem, 13cqi, 9rem);
		}
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
			grid-template-columns: minmax(0, 400px) var(--hood-gutter) minmax(0, 480px) var(--hood-gutter) minmax(0, 400px);
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
			grid-template-columns: minmax(0, 400px) var(--hood-gutter-steep) minmax(0, 480px) var(--hood-gutter-steep) minmax(0, 400px);
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
		.hood-up,
		.hood-down {
			padding-left: 0;
		}

		/* ⭐ DROP AN EMPTY COLUMN, CENTRE THE REST (round 4, item 6). The
		   empty side's track collapses to 0 (its `.hood-up`/`.hood-down` is
		   also `display: none`, see the universal rule above) and
		   `justify-content: center` (set above) re-centres the remaining
		   one or two columns in the canvas. With one side the focus track is the
		   tile column's 400px, not 480 (Gates graph AD r2 #6: a 480px focus beside
		   one column was a third empty). */
		.hood-grid--no-up {
			grid-template-columns: 0 0 minmax(0, 400px) var(--hood-gutter) minmax(0, 400px);
		}
		.hood-grid--no-down {
			grid-template-columns: minmax(0, 400px) var(--hood-gutter) minmax(0, 400px) 0 0;
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
	@container (min-width: 960px) {
		.hood-tile {
			max-width: 400px;
		}
	}
	/* The 240px floor only applies from 1100px of container; below that the
	   tracks shrink and tiles truncate instead of overflowing. */
	@container (min-width: 1100px) {
		.hood-tile {
			min-width: 240px;
		}
	}
	@container (min-width: 960px) {
		/* The focus tile is not `.hood-tile` (it is the canvas's one raised
		   object, not a service tile) — capped at 480px (≈1.2× the 400px gate
		   tiles), same reasoning. */
		[data-hood-focus] {
			max-width: 480px;
		}
	}

	/* ⭐ GATEHOUSE TILE PARTS (2026-11-12, AD round 2). One 28px row (it hosts a 28px Approve without growing), so a passing tile is
	   12 + 28 + 12 = 52px whatever its type; a held line sits under the identity, aligned past the 16px glyph and its 8px gap. */
	.gh-row {
		min-height: 28px;
	}
	/* A gate's name never shrinks below its longest word (no mid-word breaks at the narrow three-column widths, 800-1100px of
	   container): the window bar gives way first (64 -> 40px); the name wraps between words when it must. */
	.gh-name {
		min-width: auto;
		overflow-wrap: normal;
	}
	.gh-line {
		padding-left: 24px;
	}
	/* Today's deploy window, up to 64px (it yields to the gate's name, down to 40): a 24h track (line-subtle) cut into quarter-days, the
	   allowed hours in fg-subtle (a window is a fact, not a state: no hue), one 1px now tick in fg-muted, quieter than the 6px state dot.
	   While the window holds a build its shut hours and the tick take held ink (the hold is the state). */
	.gh-bar {
		position: relative;
		display: block;
		flex: 0 1 64px;
		min-width: 40px;
		height: 12px;
	}
	/* The day in four quarters: 2px cuts in the surface colour through track and spans at 06/12/18, so the bar reads as a day laid flat
	   (segments), never as a progress fill (AD r3 #3). Above the spans, under the now tick. */
	.gh-bar::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 3px;
		height: 6px;
		z-index: 1;
		background:
			linear-gradient(var(--k-surface), var(--k-surface)) calc(25% - 1px) 0 / 2px 100% no-repeat,
			linear-gradient(var(--k-surface), var(--k-surface)) calc(50% - 1px) 0 / 2px 100% no-repeat,
			linear-gradient(var(--k-surface), var(--k-surface)) calc(75% - 1px) 0 / 2px 100% no-repeat;
	}
	.gh-bar::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 4px;
		height: 4px;
		border-radius: 2px;
		background: var(--k-line-subtle);
		box-shadow: inset 0 0 0 1px var(--k-line);
	}
	.gh-bar-open {
		position: absolute;
		top: 4px;
		height: 4px;
		border-radius: 2px;
		background: var(--k-fg-subtle);
	}
	.gh-bar-shut {
		position: absolute;
		top: 4px;
		height: 4px;
		border-radius: 2px;
		background: var(--k-held-line);
	}
	/* The approver's slot while nobody this viewer can be has approved: a 20px dashed ring, the size of the Avatar that fills it. */
	.gh-slot {
		display: inline-block;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		border-radius: 9999px;
		border: 1px dashed var(--k-line-strong);
	}
	.gh-bar-now {
		position: absolute;
		top: 0;
		width: 1px;
		height: 12px;
		background: var(--k-fg-muted);
		box-shadow: 0 0 0 1px var(--k-surface);
		z-index: 2;
	}
	.gh-bar-now--held {
		background: var(--k-held-solid);
	}
</style>
