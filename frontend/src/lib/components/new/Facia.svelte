<script lang="ts">
	/**
	 * THE FACIA — one app, drawn as the rollout Overview's header at tile scale (r34 v2 round 2, lane AP).
	 * Lineage: the Footprint tile of r5–r8 (still the home of `laneOf` / `approvalOf`), rebuilt; the name is new
	 * (grep of .work and internal/ found no prior use).
	 *
	 * ROLE: answers "what is this app doing and does it need me" for one app, so a grid of apps can be compared at a
	 * glance. WHY NOTHING EXISTING FITS: a Rollouts row is one place; the Overview header is one place at page scale.
	 * An app is a set of places, so its header carries the strip as the subject. PROPORTIONS borrowed from the Overview
	 * header (PromotionLane's own strip, never a second one): AppGlyph · name, the DEPLOYED build of the place in focus
	 * beside the Rollouts row's state word, the commit of that build (title, author), the strip with its behind-words
	 * and prod squares n/of, then the failure as FailedCheckLine and the action.
	 *
	 * ONE PLACE IN FOCUS: the place the tile speaks about (the approval row, else the app's worst row, else its first
	 * production place). Its build, commit, author and pill are that place's own (data.ts deployedBuild / stateWord), so
	 * the tile can never print a build the place's tab does not.
	 * r6 (cold comprehension): the pill describes the build beside it (the tab's own word) and says where it runs; a waiting
 * candidate is its own "next <sha> · <state>" line; the strip's one tinted node is the focus place (Apps picks the lane
 * lead) and wears the neutral "this one" bar; the time names its state ("waiting 19m"). A quiet tile is name · at rest ·
 * age · strip at every width; a tile is its own bordered card at every width.
 * TILE: identity · build + pill · commit · strip · outcome · footer (age, action pinned bottom). It hugs its
	 * content; the grid equalises a row by its tallest. LEAD: the same anatomy at full width, the first region of the
	 * card (no frame of its own: the card is its frame), the strip spanning its width, then the state object — the
	 * AlertPanel for a failure, a neutral inset (strip + wait line) for a wait.
	 */
	import ApproveButton from './ApproveButton.svelte';
	import { approveAct } from './approvals.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import StarToggle from '$lib/components/StarToggle.svelte';
	import PromotionLane from '$lib/components/PromotionLane.svelte';
	import StatementBanner from '$lib/components/StatementBanner.svelte';
	import type { Act } from '$lib/components/ActRow.svelte';
	import { CodeBranchOutline, UndoOutline, CheckOutline, ClockOutline, ArrowUpRightFromSquareOutline, ChevronDownOutline, MapPinOutline } from 'flowbite-svelte-icons';
	import { getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import type { TChange } from './data';
	import type { Lane } from '$lib/view-models/promotion-lanes';
	import { ago, isViewer, approvalScope, truthAttrs, heldCauses, avatarSrc, deployedBuild, deployedHistory, buildIdentity, newestBuild, waitingBuild, waitClock, approvalTarget, appHolds, tabPill, regionStates, checkClock } from './data';
	import type { HomeState, TApp, TRow } from './data';
	import { plural, rowAction, actionLabel, actionHref, markOf, VIEWER } from './rollout-view';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { rolloutStateChip } from '$lib/view-models/rollout-state-chip';
	import HeldGlyph from '$lib/components/HeldGlyph.svelte';
	import { approvalOf } from './Footprint.svelte';
	import { approvalIn, rowPlaceName } from './state-words';
	import { pillOf, currencyOf } from './app/app-model';
		import { rolloutPath } from '$lib/source-dashboard';

	let { span = false, compact = false, framed = false, item, lane, approvals = [], lead = false, attention = false, calm = false, scenario = 'incident', last = null, recent = [], noTier = false, drawing }: {
		/** a band's last tile spans the leftover tracks of its row (r2 apps: no hole beside it): the number of columns it takes, or true for the whole row */
		span?: boolean | number;
		/** r39: the LEAD tile wears its own frame (card, 8px) — pass when the page no longer wraps the band in a card */
		framed?: boolean;
		/** Quiet on 3 columns: a healthy tile drops its state line (the band and the strip already say it) */
		compact?: boolean;
		scenario?: HomeState;
		item: TApp;
		lane: Lane;
		/** the rows of Rollouts' Waiting-for-approval group for this state */
		approvals?: TRow[];
		lead?: boolean;
		/** the attention band: carries the action */
		attention?: boolean;
		/** nothing fails fleet-wide: holds are neutral rings */
		calm?: boolean;
		/** the app's last arrival (ISO) — a quiet app's footer */
		last?: string | null;
		/** this app's merged changes, newest first (data.ts changes()): the footer's last change and the people who ship to it */
		recent?: TChange[];
		/** r39 /envs/<name>: the page is ONE tier, so the state line shows the place as plain meta (eu-west, 5 regions) instead of the tier chip */
		noTier?: boolean;
		/** r39 /envs/<name>: the app's SITES & WAVES in this environment, drawn in place of the env row (EnvRow, natural width) */
		drawing?: import('svelte').Snippet;
	} = $props();

	const appHref = $derived(`/apps/${item.app}`);
	const appr = $derived(attention && item.group !== 'needs' ? approvalOf(item, approvals) : null);
	/** time in state is the Rollouts row's `since` (the tab's instant); never a separately computed age */
	/** a "Ready to promote" app is actionable (a person promotes it): it lives in In motion, not Quiet (r6 P7) */
	const readyPromote = $derived(item.group === 'quiet' && /^Ready to promote/.test(item.fact));
	const isQuiet = $derived(item.group === 'quiet' && !readyPromote);
	/** the viewer's action on the lead row: data.ts `actionFor` (Roll back on a failing place the model gives one, Approve for an approval they can give). No invented Roll back: a row without an action links to the tab. */
	const act = $derived.by(() => {
		const r = appr?.row ?? item.row ?? null;
		return r ? rowAction(r) : null;
	});
	const label = $derived(act ? actionLabel(act) : '');
	/** the approval this Facia's Approve acts on (data.ts approvalTarget over the row the action belongs to) */
	const apTarget = $derived(act?.kind === 'approve' ? (() => { const r = appr?.row ?? item.row ?? null; return r ? approvalTarget(r, scenario) : null; })() : null);
	const actHref = $derived(act ? actionHref(act) : '');
	const stateRow = $derived(appr?.row ?? item.row ?? null);
	const fail = $derived(item.group === 'needs' ? item.row?.failure ?? null : null);
	const failCheck = $derived(fail ? { name: fail.check ?? fail.line, message: fail.check ? (fail.message ?? undefined) : undefined } : null);
	const holds = $derived(appHolds(item, scenario));
	const factLine = $derived(item.approval && holds.some((h) => h.approval) ? [] : [item.fact]);
	const outcomeText = $derived([...factLine, ...holds.map((h) => h.text).filter((h) => !item.fact.includes(h))].join(' · '));
	const apprText = $derived((appr && appr.n === 1 && appr.row.regions ? approvalScope(appr.row, scenario).sentence : appr?.text) ?? holds.find((h) => h.approval)?.text ?? '');
	const parts = $derived(appr ? [apprText, ...(item.approval || /^(Deploying|Checking)\b/.test(item.fact) ? [] : [item.fact])] : readyPromote ? ['Ready to promote to prod · needs a person'] : isQuiet ? [item.fact] : outcomeText.split(' · '));
	/** r6 P6: one vocabulary for a hold — "Held: waiting on X" / "Waiting for approval" (never "Waits on …") */
	const vocab = (t: string) => t.replace(/^Waits on /, 'held: waiting on ').replace(/^Held: /, 'held: ').replace(/\bproduction\b/g, 'prod');
	const cause = $derived(parts.slice(1).map(vocab).join(' · ') || null);
	/** apps-7 Q7: "prod" everywhere on a tile, never "production" */
	const prodWord = (t: string) => t.replace(/\bproduction\b/g, 'prod');
	/** A8: a quiet app that is simply at rest says so in its name row on a phone (one line), so its fact line folds away there */
	const atRest = $derived(isQuiet && /at rest/.test(item.fact));
	const place = $derived(appr ? appr.href : isQuiet ? null : item.outcomeHref);
	const tileHref = $derived(isQuiet || !item.row ? appHref : item.row.href);
	const summary = $derived(`${item.app}: ${item.fact}`);

	/** H1/H2 — the ONE place the tile speaks about: its build, commit and pill are that place's own. A quiet app speaks for its first production place. */
	const focus = $derived.by(() => {
		if (stateRow) return { app: item.app, href: stateRow.href, version: stateRow.version, state: stateRow.state, word: stateRow.word };
		const p = item.placeList.find((x) => x.tier === 'prod') ?? item.placeList[0];
		return p ? { app: item.app, href: p.href, version: p.version, state: p.state, word: '' } : null;
	});
	const dep = $derived(focus ? deployedBuild(focus as never) : null);
	const build = $derived(dep?.build || focus?.version || '');
	/* r6 P9: a placeholder title says nothing the build id does not */
	const commit = $derived(dep?.title && !/^(Initial commit|Release commit for build )/.test(dep.title) ? { title: dep.title, who: dep.author } : null);
	/** L3 — a place that waits (approval or rule): the tile names the WAITING build, never the deployed one */
	const waitRow = $derived(stateRow && (stateRow.state === 'awaiting-approval' || stateRow.state === 'held-by-rule') ? stateRow : null);
	const wait = $derived(waitRow ? waitingBuild(waitRow) : null);
	/** apps-7 Q1: a wait's age is `waitClock` (QA2 #8) — the same clock the Rollouts row's sentence prints; otherwise the row's */
	const age = $derived(isQuiet ? '' : ago((waitRow ? waitClock(waitRow) : null) ?? (appr?.row ?? item.row)?.since ?? item.since));
	/** r6 P2: the lag of the focus place in words a first-time reader can place: "prod is 7 builds behind the newest" (not a link). Skipped when the one newer build IS the waiting "next" build. */
	const placeName = $derived.by(() => {
		const r = stateRow;
		if (r) return rowPlaceName(r);
		const pl = focus ? item.placeList.find((x) => x.href === focus.href) : null;
		return pl ? (pl.tier === 'prod' ? 'prod' : pl.label) : '';
	});
	const nb = $derived((lead || waitRow) && focus ? newestBuild(focus as never) : null);
	/** apps-7 Q4: the lag sentence is printed ONLY when the strip's cell for the focus place shows no lag word of its own (one lag form per tile) */
	const focusNode = $derived(focus ? [...lane.stages, ...lane.prod].find((n) => hrefFor(n) === focus.href) ?? null : null);
	const newer = $derived(nb && focus?.state !== 'failed' && !(wait && nb.count <= 1) && !(focusNode && focusNode.behind > 0) && !(lane.prod.length > 1 && focusNode?.tier === 'prod') ? `${placeName} is ${nb.count} build${nb.count === 1 ? '' : 's'} behind the newest` : null);
	/** r6 P1: the pill is the TAB's own word for the build next to it (DEPLOYED / FAILED / DEPLOYING / CHECKING); a candidate that waits is a separate labelled "next" line */
	/* apps-12 AT1: the pill is app-model's pillOf (the app page's header reads the same function): the tab's word for the app's headline (production) place, stable across lenses */
	const headPill = $derived(pillOf(item.placeList, scenario));
	const pill = $derived(headPill ? { word: headPill.word, role: headPill.role } : null);
	/** the headline build: the one the pill's place runs (the row the tile speaks about may be another place — its own build stays in its NEXT/CHECKING line) */
	const headBuild = $derived(headPill ? deployedBuild({ app: item.app, href: headPill.place.href, version: headPill.place.version } as never)?.build || headPill.place.version || '' : '');
	/** the tab's word for the place the tile SPEAKS ABOUT (its state row): what kind of line the tile prints */
	/* state keeps its hue: a pill only for a place that is not at rest (failed / deploying / checking / held); DEPLOYED stays unsaid */
	const showPill = $derived(!!pill && pill.word !== 'DEPLOYED');
	const rowWord = $derived(stateRow ? tabPill({ href: stateRow.href }).word : (pill?.word ?? ''));
	/** the headline's role word: where the build named beside the pill runs */
	const runIn = $derived(focus && pill ? `${({ FAILED: 'in', DEPLOYING: 'to', CHECKING: 'in' } as Record<string, string>)[pill.word] ?? 'running in'} ${placeName}` : '');
	/* r2 apps fix 7: the age slot is the TIME and nothing else (the state line and the banner already say what state it is the age of) */
	/** r6 P6: ONE vocabulary for a build that does not run yet: "waiting for your approval in 5 of 6 prod regions" / "held: waiting on Integration tests in staging" (the count is the squares' own held count) */
	const waitText = $derived.by(() => {
		if (!waitRow || !wait) return '';
		if (waitRow.state === 'awaiting-approval') {
			const regs = regionStates(item.app, scenario);
			const k = regs.filter((r) => r.ink === 'waiting').length;
			const scope = waitRow.tier === 'prod' && regs.length > 1 && k ? `${k} of ${regs.length} prod regions` : waitRow.place;
			return `waiting for ${rowAction(waitRow)?.kind === 'approve' ? 'your ' : ''}approval in ${scope}`;
		}
		return `held: ${(parts[0] ?? '').replace(/^Waits /, 'waiting ').replace(/^Waiting /, 'waiting ')}`;
	});
	/* apps-10 AR5: ONE state for the lead — when the tab's own pill says the focus place is CHECKING, the banner says Checking (+ the tab's clock), never "waiting for approval" beside a Checking cell */
	const checkingNow = $derived(!!waitRow && rowWord === 'CHECKING');
	const checkLeft = $derived(checkingNow && focus ? checkClock({ href: focus.href, state: 'checking', group: 'rest' } as never) : null);
	const leadHead = $derived(waitText ? waitText.charAt(0).toUpperCase() + waitText.slice(1) : parts[0] ?? '');
	const nextAuthor = $derived(wait?.author && !isViewer(wait.author) ? wait.author : null);
	const viewer = $derived(isViewer(commit?.who));
	const whoOf = (w: string | null) => (isViewer(w) ? 'you' : w);
	/** L1: the Overview's own "current" ring on the place the lead speaks about */
	/** r6 P3: the ONE focus place wears the Overview's neutral "this one" bar on every tile that speaks about a place (a quiet tile speaks about none); the tint belongs to it alone (Apps hands the strip its lead) */
	/** apps-7 Q3: /apps has no "you are here": no cell is handed the current underline (PromotionLane's is-live/current marker is data) */
	const current = null;
	/**
	 * apps-7 Q0 — THE TWO LINES. Line 1 = name · pill · ONE verb-time ("waiting 19m"); line 2 = the one cause or next step
	 * ("next f4a2c19 · your approval · 5 of 6 regions" / the failing check's name / "deploying to staging"). Everything else
	 * (the deployed build and where it runs, its commit, the lag sentence, the check message, hold causes, the pin) is the
	 * tile's DETAILS: behind one per-tile chevron below 640 (aria-expanded, opens in place), always printed from 640 up.
	 */
	const kind = $derived<'quiet' | 'failed' | 'wait' | 'ready' | 'deploying' | 'checking' | 'run'>(isQuiet ? 'quiet' : failCheck ? 'failed' : waitRow ? 'wait' : readyPromote ? 'ready' : rowWord === 'DEPLOYING' ? 'deploying' : rowWord === 'CHECKING' ? 'checking' : 'run');
	const regs = $derived(regionStates(item.app, scenario));
	/** Q1: "4 of 6 prod regions" when prod runs several builds; the build the tile names is the one the focus place runs */
	const runScope = $derived.by(() => {
		if (placeName !== 'prod' || regs.length < 2 || !focus?.version) return placeName;
		const k = regs.filter((r) => r.build === focus.version).length;
		return k && k < regs.length ? `${k} of ${regs.length} prod regions` : 'prod';
	});
	const waitScope = $derived.by(() => {
		if (!waitRow) return '';
		const k = regs.filter((r) => r.ink === 'waiting').length;
		/* apps-9 AQ7: "5 regions" (the strip already says prod); a single place that is just "prod" repeats the strip and prints nothing */
		if (waitRow.tier === 'prod' && regs.length > 1 && k) return k === regs.length ? `${k} regions` : `${k} of ${regs.length} regions`;
		const p = prodWord(waitRow.place);
		return p === 'prod' ? '' : p;
	});
	const gate = $derived(prodWord((parts[0] ?? '').replace(/^Waits on /, '')).replace(/ in (prod|[\w.-]+)$/, ''));
	/**
	 * apps-8 AP4 (P8 tile meta) — at most TWO keyed slot lines, each a row of a 44px key track | build (mono) | cause | right figure:
	 * NEXT (a build that waits: its cause and, right, how long) and CHECK (the failing check and its one figure), RUNS (build + its currency) for a settled
	 * build. No "·" run holds an id; the commit, author and lag live on the app page.
	 */
	/** apps-13 AL1/AL3: the headline place's currency against THIS app's own newest build (its tab's Newer builds list) */
	const headCurrency = $derived(headPill ? currencyOf(headPill.place.href, item.app).word : '');
	const slots = $derived.by(() => {
		/* apps collapsed r1: no CHECK/NEXT/RUNS keys; a slot says only what the lane does not. A deploying or checking place is already its cell's mark + word; a settled app is the rest line. */
		const out: { key: string; build?: string; pre?: string; text: string; right?: string }[] = [];
		if (kind === 'wait') {
			/* the build that waits and its dwell (truth-5); the sentence only where it adds a scope ("your approval · 5 of 6 regions"), never the bare word the cell already says */
			const approval = waitRow?.state === 'awaiting-approval';
			out.push({ key: 'wait', build: wait?.build ?? '', pre: approval && rowAction(waitRow!)?.kind === 'approve' ? 'your ' : '', text: approval ? (waitScope ? `approval · ${waitScope}` : '') : `waiting on ${gate}`, right: '' });
		} else if (kind === 'failed') out.push({ key: 'check', text: `Check · ${(failCheck?.name ?? '').replace(new RegExp(`^${item.app}-(?=.{5})`), '')}` });
		else if (kind === 'ready') out.push({ key: 'ready', text: 'Ready to promote' });
		return out;
	});
	const line2 = $derived.by(() => {
		switch (kind) {
			case 'wait': return waitRow?.state === 'awaiting-approval' ? `${rowAction(waitRow) ?.kind === 'approve' ? 'your ' : ''}approval${waitScope ? ` · ${waitScope}` : ''}` : `held: waiting on ${gate}`;
			case 'failed': return `${(failCheck?.name ?? '').replace(new RegExp(`^${item.app}-(?=.{5})`), '')} · ${placeName}`;
			case 'deploying': return `deploying to ${placeName}`;
			case 'checking': return `checking in ${placeName}`;
			case 'ready': return 'ready to promote to prod';
			case 'quiet': return prodWord(item.fact);
			default: return `running in ${runScope}`;
		}
	});
	const pinned = $derived((cause ?? '').split(' · ').find((x) => /^Pinned/.test(x))?.replace(/ in ([\w-]+)$/, ' · $1') ?? null);
	const causes = $derived((cause ?? '').split(' · ').filter((x) => x && !/^Pinned/.test(x) && !/approval/i.test(x)).map(prodWord));
	const failMsg = $derived(kind === 'failed' ? fail?.message ?? null : null);
	/* apps-8 AP4: the time beside the pill is the PILL's (failing 9h, deploying 4m); a wait's age is the NEXT row's, never a verb the pill does not say */
	/* apps-12 AT6: ONE age slot on every tile — right of the identity line (the slot lines carry no age): a wait/deploy/check's own age, a failure's "failing 9h", a settled or ready app's last arrival */
	const bumpTime = $derived(kind === 'ready' || kind === 'quiet' || kind === 'run' ? (last ? ago(last) : '') : age);
	const unitRe = /(\d+ (?:build behind|builds behind|behind|prod regions|places)|[A-Za-z0-9.]+(?:-[A-Za-z0-9.]+)+)/;
	/** A4: a " · " is glued to the words on both sides (no-break spaces), so a line can never end or start with the dot */
	const glue = (t: string) => t.replace(/ · /g, '\u00A0·\u00A0');
	const chunks = (t: string) => glue(t).split(unitRe).map((x, i) => ({ x, nw: i % 2 === 1 }));
	/**
	 * A3 — ONE form for all the lag words of a strip: "1 build behind" when every cell fits, else "1 behind" in every
	 * cell (the full words stay in the node's title). Never an ellipsis, never a bare number. The text node is rewritten
	 * in place and the strip re-measured whenever it is resized or Svelte writes a new count.
	 */
	/**
	 * apps collapsed r1 (owner decision 2026-11-01) — a place at rest says nothing but its ring. Every tier whose places all run
	 * healthy (lane state newest / behind) leaves the strip and becomes one neutral ring (StatusMark "behind", the product's own
	 * at-rest mark) in a single group: no word, the title and the aria-label name the places ("dev, staging: healthy"). Only an
	 * adverse place (failing, held, waiting, deploying, checking) keeps its cell: mark + word. Below 640 each ring carries its
	 * place's name in t-meta (a row of "ring dev · ring staging", never rings floating alone). A tile whose every place is at rest
	 * draws no strip at all: the rings and one line, "All healthy · up to date".
	 */
	const TIERS = ['dev', 'test', 'staging', 'other', 'prod'] as const;
	const AT_REST = new Set(['newest', 'behind']);
	const tierList = $derived(TIERS.filter((t) => lane.byTier[t]?.length));
	const restTiers = $derived(tierList.filter((t) => lane.byTier[t]!.every((n) => AT_REST.has(n.state))));
	const shownTiers = $derived(tierList.filter((t) => !restTiers.includes(t)));
	const allRest = $derived(tierList.length > 0 && !shownTiers.length);
	/** one name per tier: a prod set of regions is "prod" */
	const restNames = $derived(restTiers.map((t) => (t === 'prod' ? 'prod' : lane.byTier[t]!.map((n) => n.env).join(', '))));
	const restTitle = $derived(restNames.length ? `${restNames.join(', ')}: healthy` : '');
	/** the tile is an app with nothing to say but "healthy": its own line replaces the slot row and the strip */
	const restLine = $derived(allRest && (kind === 'run' || kind === 'quiet'));
	const restText = $derived(`All healthy${headCurrency ? ` · ${headCurrency.charAt(0).toLowerCase()}${headCurrency.slice(1)}` : ''}`);
	const hrefFor = (n: { card: unknown }) => { const c = n.card as { href?: string; sourceCluster?: string; ns: string; name: string }; return c.href ?? rolloutPath(c.sourceCluster || '', c.ns, c.name); };

	/**
	 * THE NAMEPLATE (r34 /apps pass, variant A). Role: identity first (32px glyph + 16/600 name), then ONE state line on a 16px mark
	 * column, the env rail, and a two-track footer (last change | who ships it). State lives in the rail words and the state line only:
	 * there is no pill beside the name. Reference: the rollout Overview's header (name, one state sentence) at tile scale; the footer
	 * borrows the Changes row's commit · title · #PR · age. No vanity totals.
	 */
	/**
	 * r2 apps: the env badge is the JOINED badge (Chip role="env" splits at the first "-"): [PROD | eu-west] for ONE region, [PROD | 6 regions] for a set,
	 * [DEV] / [STAGING] for a single place. The place leaves the state line ("5 of 6 regions" is the strip's own figure).
	 */
	/** one-tier page: the place without its tier ("prod-eu-west" -> "eu-west", "5 prod regions" -> "5 regions", a lone tier -> nothing) */
	const noTierPlace = $derived.by(() => { const l = envOf?.label ?? ''; const t = stateRow?.tier ?? ''; const x = l.replace(new RegExp(`^${t}-`), '').replace(/^(\d+) prod regions?$/, (_m, n) => `${n} regions`); return x === t || x === 'prod' || x === 'production' ? '' : x; });
	const envOf = $derived.by(() => {
		const r = stateRow;
		if (!r) return null;
		let name = item.placeList.find((x) => x.href === r.href)?.env ?? placeName;
		if (r.tier === 'prod' && (r.regionsOf || regs.length > 1)) {
			const ink = kind === 'failed' ? 'failed' : kind === 'wait' ? 'waiting' : null;
			const hit = ink ? regs.filter((x) => x.ink === ink) : [];
			const n = hit.length || r.regions.length;
			name = n === 1 ? `prod-${(hit[0]?.label ?? r.regions[0] ?? '').replace(/^prod-/, '')}` : n > 1 ? `${n} prod regions` : 'prod';
		}
		return { label: name, theme: getRolloutEnvironmentTheme(null, r.tier === 'prod' ? 'prod' : name) };
	});
	/**
	 * r2 apps fix 2: ONE frontier for the word, the glyph and the hue — the tab's own pill word for the place the tile speaks about (`rowWord`), the same one the strip's cell prints.
	 * A place the tab shows CHECKING that is also gated says "Checking" (clock, progress hue), then "waits for approval"; it is not "Waiting for approval" in orange beside a Checking cell.
	 */
	/* r2-cleanup: the strand beside the line says the state word (Checking / Deploying / Waiting) in its hue; the line keeps the badge + the reason (what is needed, the check, the build) and does not say the word twice */
	const stateLine = $derived.by((): { ink: string; lead: string; rest: string; build: string; badge: boolean } => {
		const gateWord = (parts[0] ?? '').replace(/^Waits on /, '');
		switch (kind) {
			case 'failed': return { ink: 'text-danger', lead: (failCheck?.name ?? '').replace(new RegExp(`^${item.app}-(?=.{5})`), ''), rest: failMsg ?? '', build: '', badge: true };
			case 'wait': return checkingNow
				? { ink: 'text-progress', lead: '', rest: waitRow?.state === 'awaiting-approval' ? `Then waits for ${rowAction(waitRow)?.kind === 'approve' ? 'your ' : ''}approval` : '', build: wait?.build ?? '', badge: true }
				: waitRow?.state === 'awaiting-approval'
				? { ink: 'text-held', lead: approvalIn(rowAction(waitRow)?.kind === 'approve', placeName), rest: '', build: wait?.build ?? '', badge: true }
				: { ink: 'text-held', lead: `Waiting on ${prodWord(gateWord).replace(/ in (prod|[\w.-]+)$/, '')}`, rest: '', build: wait?.build ?? '', badge: true };
			case 'deploying': return { ink: 'text-active', lead: '', rest: '', build: build, badge: true };
			case 'checking': return { ink: 'text-progress', lead: '', rest: '', build: build, badge: true };
			case 'ready': return { ink: 'text-fg', lead: 'Ready to promote to prod', rest: '', build: '', badge: false };
			case 'quiet': return restLine || /at rest|healthy/i.test(item.fact) ? { ink: 'text-fg', lead: 'All healthy', rest: headCurrency ? headCurrency.charAt(0).toLowerCase() + headCurrency.slice(1) : '', build: '', badge: false } : { ink: 'text-fg-muted', lead: prodWord(item.fact), rest: '', build: '', badge: false };
			default: return restLine ? { ink: 'text-fg', lead: 'All healthy', rest: headCurrency ? headCurrency.charAt(0).toLowerCase() + headCurrency.slice(1) : '', build: '', badge: false } : { ink: 'text-fg-muted', lead: line2.replace(/^./, (c) => c.toUpperCase()), rest: '', build: '', badge: false };
		}
	});
	const lineMark = $derived<'failed' | 'held' | 'approval' | 'deploying' | 'checking' | 'behind' | null>(!stateRow ? 'behind' : kind === 'quiet' || kind === 'ready' || kind === 'run' ? 'behind' : (checkingNow ? 'checking' : markOf(stateRow)) as never);
	/** the last merged change: data.ts changes() for this app; else the focus place's deployed commit; never invented */
	const last1 = $derived(recent[0] ?? null);
	const lastChange = $derived.by(() => {
		if (last1) return { title: last1.title, pr: last1.prNumber, at: last1.mergedAt, who: last1.who };
		if (commit) return { title: commit.title, pr: null as number | null, at: dep?.at ?? null, who: commit.who };
		if (build && dep?.at) return { title: `Deployed ${build}`, pr: null as number | null, at: dep.at, who: null as string | null };
		return null;
	});
	/** who ships to this app: authors of its merged changes, then of its deploys; the viewer is drawn like anyone */
	const shippers = $derived.by(() => {
		const seen: string[] = [];
		const add = (w: string | null | undefined) => { if (w && !/^(bot|ci|controller)/i.test(w) && !seen.includes(w)) seen.push(w); };
		for (const c of recent) add(c.who);
		for (const p of item.placeList) for (const h of deployedHistory(p.href, 8)) add(h.author);
		return seen;
	});
	/**
	 * r2 apps fix 1 — ONE STORY FOR THE LEAD. The title's build is the build the banner is about (the waiting candidate for a wait, the failing place's own build
	 * for a failure), and the footer names THAT build's change (buildIdentity: title, #PR, author) or is omitted — never the app's newest merged change.
	 */
	const leadBuild = $derived.by(() => {
		if (!lead) return '';
		if (kind === 'wait' && wait?.build) return wait.build;
		if (kind === 'failed' && stateRow) return deployedBuild({ app: item.app, href: stateRow.href, version: stateRow.version } as never).build || stateRow.version || '';
		return headBuild || build;
	});
	const leadChange = $derived.by(() => {
		if (!lead || !leadBuild) return null;
		const id = buildIdentity(leadBuild, stateRow?.href);
		if (id) return { title: id.title, pr: id.pr, who: id.author };
		if (kind === 'wait' && wait?.title) return { title: wait.title, pr: null as number | null, who: wait.author };
		return null;
	});

	/** the Facia's one action as a banner Act (label, href and icon per kind) */
	function actAsAct(): Act | undefined {
		if (!act) return undefined;
		if (act.kind === 'approve') return approveAct(apTarget, { icon: CheckOutline }) ?? { label, href: actHref, icon: CheckOutline, key: act.kind };
		return { label, href: actHref, icon: act.kind === 'rollback' ? UndoOutline : undefined, key: act.kind };
	}
</script>

{#snippet envRow(cls: string)}
	<!-- r39 (owner 2026-11-08: "Apps tiles use the boxed env row"): the SAME PromotionLane every page draws, neutral boxes (no current), bare = no app name column.
	     The tile is one link, so nothing inside the row is a target. -->
	<div class="pointer-events-none min-w-0 {cls}"><PromotionLane {lane} hrefFor={() => tileHref} showApp={false} fill={lead ? 'L' : 'M'} {calm} /></div>
{/snippet}

{#snippet facts(t: string)}{#each chunks(t) as c}{#if c.nw}<span class="whitespace-nowrap">{c.x}</span>{:else}{c.x}{/if}{/each}{/snippet}

{#snippet commitLine()}
	{#if commit}
		<span class="t-meta flex min-w-0 items-start gap-2 text-fg-muted">
			{#if commit.who && !viewer}<Avatar name={commit.who} src={avatarSrc(commit.who)} size={16} class="shrink-0" />{/if}
			{#if commit.who}<span class="shrink-0 whitespace-nowrap">{viewer ? 'you' : commit.who}</span>{/if}
			<CodeBranchOutline class="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-disabled" aria-hidden="true" /><span class="min-w-0 break-words text-fg-subtle">{commit.title}</span>
		</span>
	{/if}
{/snippet}

<!-- r39 (2026-11-08): tile actions are 32px (btn-sm) everywhere: Approve the one blue, Roll back the outline. `xs` is kept for callers and means nothing now. -->
{#snippet actionBtn(primary: boolean, _xs = false)}
	{#if act?.kind === 'approve'}
		<ApproveButton target={apTarget} fallbackHref={actHref} icon class="btn btn-sm {primary || act?.kind === 'approve' ? 'btn-primary' : 'btn-secondary'} shrink-0 gap-2 max-sm:min-h-11" />
	{:else if act}
		<a href={actHref} class="btn btn-sm {primary ? 'btn-primary' : 'btn-secondary'} relative z-[1] shrink-0 gap-2 max-sm:min-h-11">
			{#if act.kind === 'rollback'}<UndoOutline class="h-4 w-4" aria-hidden="true" />{:else}<ArrowUpRightFromSquareOutline class="h-4 w-4" aria-hidden="true" />{/if}{label}
		</a>
	{/if}
{/snippet}

{#snippet stateMark()}
	<!-- apps-7 Q2: a wait is the tab's pause mark, never the person icon (StatusMark's approval) -->
	{#if stateRow}<span class="flex h-5 shrink-0 items-center">{#if markOf(stateRow) === 'held' || markOf(stateRow) === 'approval'}<HeldGlyph size={16} class="text-held" title="Held" />{:else}<StatusMark state={markOf(stateRow)} />{/if}</span>{/if}
{/snippet}

{#snippet code(b: string)}<span class="t-code font-medium text-fg">{b}</span>{/snippet}

{#snippet timeBit()}
	<!-- r2 apps fix 7: the age is a fixed track (right-aligned, tabular), just before the star, on every tile including the lead; it prints the time and nothing else -->
	<span class="t-meta ml-auto w-10 shrink-0 whitespace-nowrap text-right tabular-nums text-fg-subtle" data-fp-age>{bumpTime}</span>
{/snippet}

{#snippet slotLines()}
	<!-- apps collapsed r1: slots lose their CHECK / NEXT keys: the check name or the waiting build sits alone under the app name, build | cause | right figure -->
	{#if slots.length}
		<dl class="fp-slots m-0 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-y-1" data-fp-line2>
			{#each slots as sl (sl.key)}
				<div class="contents">
					<dd class="m-0 flex min-w-0 items-baseline gap-2 max-sm:items-start">
						{#if sl.build}<span class="t-code-sm shrink-0 text-fg">{sl.build}</span>{/if}
						{#if sl.text}<span class="t-ui-sm min-w-0 text-fg-muted sm:truncate max-sm:break-words" title={(sl.pre ?? '') + sl.text}>{#if sl.pre}<span class="max-[379px]:hidden">{sl.pre}</span>{/if}{sl.text}</span>{/if}
						{#if sl.right}<span class="t-meta ml-auto shrink-0 whitespace-nowrap tabular-nums text-fg-subtle ">{sl.right}</span>{/if}
						</dd>
				</div>
			{/each}
		</dl>
	{/if}
{/snippet}

<li
	style={typeof span === 'number' && span > 1 ? `grid-column: span ${span} / span ${span}` : undefined}
	class="fp tap-zone flex min-w-0 flex-col {span === true ? 'col-span-full' : ''} {lead ? (framed ? 'fp-lead gap-5 rounded-[8px] border border-line bg-surface p-5 max-sm:p-4' : 'fp-lead') : 'fp-tile gap-5 rounded-[8px] border border-line bg-surface p-5 transition-colors hover:bg-hover max-sm:p-4 sm:max-[1279px]:p-4'}"
	data-truth-kind="app" data-truth-app={item.app} data-truth-group={item.group} data-truth-fact={item.fact} data-truth-href={tileHref}
	data-fp-build={headBuild || build} data-fp-pill={pill?.word ?? ''}
	{...item.row ? truthAttrs(item.row) : {}}
>
	{#if lead}
		<!-- lead: glyph · name · build (mono; on a phone it takes its own line under the name, never dropped) · age track · star -->
		<div class="flex min-w-0 items-center gap-x-3 max-sm:gap-x-2">
			<AppGlyph name={item.app} size={32} />
			<a href={appHref} class="tap-link t-title ap-lead-name min-w-0 break-words text-fg hover:underline max-sm:flex-1" aria-label={summary}>{item.app}</a>
			{#if leadBuild}<span class="t-meta text-fg-disabled max-sm:hidden" aria-hidden="true">/</span><span class="t-code-lg shrink-0 text-fg max-sm:hidden" data-fp-lead-build>{leadBuild}</span>{/if}
			{@render timeBit()}
			<StarToggle app={item.app} class="max-sm:!h-11 max-sm:!w-11 max-sm:-my-3 max-sm:-mr-3" />
		</div>
		{#if leadBuild}<p class="t-code m-0 -mt-1 min-w-0 break-all text-fg sm:hidden" data-fp-lead-build-phone>{leadBuild}</p>{/if}
		{#if kind === 'wait'}
			<!-- no orphan sha line: the title names the waiting build and the banner says what releases it -->
		{:else if kind === 'ready'}
			<div class="flex min-w-0 items-start gap-2">
				<div class="min-w-0 flex-1">{@render slotLines()}</div>
			</div>
		{:else}
			{#if kind !== 'failed'}
				<!-- apps collapsed r1: the lead's commit title is one tap away (Open rollout); only the phone keeps its one short line -->
				<div class="flex min-w-0 items-center gap-2 sm:hidden" data-fp-line2>
					<p class="t-body min-w-0 flex-1 text-fg-muted max-sm:truncate">{#if kind === 'quiet'}{prodWord(item.fact)}{:else}{@render facts(line2)}{/if}</p>
				</div>
			{/if}
		{/if}
		{@render envRow('')}
		{#if failCheck}
			<StatementBanner severity="failed" title="Deployment failed" check={failCheck}
				secondary={[...(place ? [{ label: 'Open rollout', href: place, key: 'open-rollout' }] : []), ...(act && act.kind !== 'approve' ? [actAsAct()!] : [])]} primary={act?.kind === 'approve' ? actAsAct() : undefined} />
		{:else if waitRow}
			<!-- apps-7 Q2: the tab's own held banner (the shared StatementBanner: tint, 40px pause disc, the tab's sentence) -->
			<StatementBanner severity={checkingNow ? 'checking' : 'held'} title={checkingNow ? 'Checking' : waitRow.state === 'awaiting-approval' ? 'Waiting for approval' : `${placeName} is held: waiting on ${gate}`} message={checkingNow ? `${checkLeft ? checkLeft.replace(/\.$/, '') + '. ' : 'The health checks are running. '}${waitRow.state === 'awaiting-approval' ? `Then it waits for ${act?.kind === 'approve' ? 'your ' : ''}approval${placeName ? ' in ' + placeName : ''}.` : ''}`.trim() : waitRow.state === 'awaiting-approval' && wait?.build ? `${act?.kind === 'approve' ? 'Your approval' : 'An approval'} releases ${wait.build} ${waitScope ? 'in ' + waitScope : placeName ? 'to ' + placeName : ''}.`.replace(/ \.$/, '.') : nb ? (waitRow.state === 'awaiting-approval' ? `${nb.count} newer build${nb.count === 1 ? ' is' : 's are'} waiting.` : `${nb.count} newer build${nb.count === 1 ? ' is' : 's are'} waiting. Nothing promotes itself until someone clears the hold.`) : undefined}
				primary={act?.kind === 'approve' ? actAsAct() : undefined}
				secondary={[...(act && act.kind !== 'approve' ? [actAsAct()!] : []), ...(place ? [{ label: 'Open rollout', href: place, after: true, key: 'open-rollout' }] : [])]} />
		{:else if act}
			<div class="flex justify-end">{@render actionBtn(false)}</div>
		{/if}
	{:else}
		<!-- r34 /apps pass A: identity (glyph 32 · name 16/600 · age · star) · ONE state line on the 16px mark column · the rail · action · two-track footer -->
		<div class="flex min-w-0 items-center gap-x-3 max-[399px]:gap-x-2">
			<AppGlyph name={item.app} size={32} />
			<a href={appHref} class="tap-link t-card-title min-w-0 flex-[0_1_auto] truncate text-fg hover:underline max-[399px]:flex-none max-[399px]:max-w-full" aria-label={summary}>{item.app}</a>
			{@render timeBit()}
			<StarToggle app={item.app} class="max-sm:!h-11 max-sm:!w-11 max-sm:-mr-3" />
		</div>
			<div style:display={!noTier && !act && (kind === 'deploying' || kind === 'checking') ? 'none' : undefined} class="fp-state flex min-w-0 items-start gap-x-2 max-sm:flex-wrap max-sm:gap-y-2" data-fp-line2 data-state-line={kind}>
			<span class="flex h-5 w-4 shrink-0 items-center justify-center">{#if lineMark === 'held' || lineMark === 'approval'}<HeldGlyph size={16} class="text-held" title="Held" />{:else if lineMark}<StatusMark state={lineMark as never} />{/if}</span>
			<!-- two tracks: the env badge, then the message; a wrapped message hangs on the MESSAGE's own x, never under the badge -->
				<div class="t-ui-sm m-0 flex min-w-0 flex-1 items-start gap-x-2 leading-5 text-fg-muted max-sm:basis-[calc(100%-1.5rem)] max-sm:flex-wrap max-sm:gap-y-1" title={[stateLine.lead, stateLine.rest, stateLine.build].filter(Boolean).join(' · ')}>
					{#if stateLine.badge && envOf && noTier}{#if noTier}{#if noTierPlace}<span class="t-meta inline-flex h-5 shrink-0 items-center text-fg-subtle" data-place>{noTierPlace}</span>{/if}{:else}<span class="inline-flex h-5 shrink-0 items-center"><Chip role="env" theme={envOf.theme} label={envOf.label} /></span>{/if}{/if}
					<p class="m-0 min-w-0 flex-1 max-sm:basis-full">{#if stateLine.lead}<span class="mr-1 font-medium {stateLine.ink}">{stateLine.lead}</span>{' '}{/if}{#if stateLine.rest}<span class="mr-2 font-normal ">{stateLine.rest}</span>{/if}{#if stateLine.build}<span class="t-code-sm whitespace-nowrap text-fg-subtle">{stateLine.build}</span>{/if}</p>
				</div>
				{#if attention && act && !checkingNow}<span class="-my-1 shrink-0 max-sm:my-0 max-sm:basis-full max-sm:pl-6" data-fp-action>{@render actionBtn(false, true)}</span>{/if}
			</div>
			{#if drawing}{@render drawing()}{:else}{@render envRow('')}{/if}
	{/if}
	<!-- tile footer, two fixed tracks: the change (commit icon · title · #PR · age) | who ships to it (avatar stack). Phone: folds behind the state line's chevron.
	     LEAD (r2 apps fix 1): the footer names the change of the build the title and banner are about (title · #PR | its author, no second age), or is omitted. -->
	{#if lead ? leadChange : !isQuiet && (lastChange || shippers.length)}
		<div class="fp-foot-row mt-auto grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 {lead ? '' : 'border-t border-line-subtle pt-4'} " data-fp-footer>
			{#if lead && leadChange}
				<span class="t-meta flex min-w-0 items-center gap-2 text-fg-muted">
					<CodeBranchOutline class="h-4 w-4 shrink-0 text-fg-disabled" aria-hidden="true" /><span class="min-w-0 truncate" title={leadChange.title}>{leadChange.title}</span>{#if leadChange.pr}<span class="t-code-sm shrink-0 text-fg-subtle">#{leadChange.pr}</span>{/if}
				</span>
				{#if leadChange.who}
					<span class="t-meta flex shrink-0 items-center gap-2 text-fg-muted" data-fp-shippers title={whoOf(leadChange.who)}><span class="{isViewer(leadChange.who) ? '' : 'max-sm:hidden'}">{whoOf(leadChange.who)}</span>{#if !isViewer(leadChange.who)}<Avatar name={leadChange.who} src={avatarSrc(leadChange.who)} size={20} />{/if}</span>
				{/if}
			{:else}
			<span class="t-meta flex min-w-0 items-center gap-2 text-fg-muted">
				{#if lastChange}<CodeBranchOutline class="h-4 w-4 shrink-0 text-fg-disabled" aria-hidden="true" /><span class="min-w-0 {compact ? 'line-clamp-2' : 'truncate'}" title={lastChange.title}>{lastChange.title}</span>{#if lastChange.pr}<span class="t-code-sm shrink-0 text-fg-subtle">#{lastChange.pr}</span>{/if}{#if !noTier && !lead && (kind === 'deploying' || kind === 'checking') && build}<span class="t-code-sm shrink-0 text-fg-subtle" data-fp-build-quiet>{build}</span>{/if}{#if lastChange.at}<span class="shrink-0 whitespace-nowrap tabular-nums text-fg-subtle">{ago(lastChange.at)}</span>{/if}{/if}
			</span>
			{#if shippers.length}
				<span class="flex shrink-0 items-center" data-fp-shippers title={shippers.map((w) => (isViewer(w) ? 'you' : w)).join(', ')}>
					{#each shippers.slice(0, 3) as w, i (w)}<span class="shrink-0 rounded-full ring-2 ring-surface {i ? '-ml-1' : ''}"><Avatar name={w} src={avatarSrc(w)} size={20} /></span>{/each}
					{#if shippers.length > 3}<span class="t-meta ml-1.5 tabular-nums text-fg-subtle">+{shippers.length - 3}</span>{/if}
				</span>
			{/if}
			{/if}
		</div>
	{/if}
</li>

<style>
	/* apps-8 AP4: the keyed slot lines: a 44px key track, then build | cause | right figure */
	.fp-slots { grid-template-columns: minmax(0, 1fr); }
	/* apps collapsed r1 — neutral at rest: hue is spent only on failing (red) and held/waiting (orange) and the one Roll back (blue).
	   Monograms, region squares, and the deploying/checking cells keep their glyph and lose their hue. */
	/* r34 apps-envs: the strip is EnvSlots (four fixed tracks); the tile is one link, so nothing inside the strip is a target */
</style>
