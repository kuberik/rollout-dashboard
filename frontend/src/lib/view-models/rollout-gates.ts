/**
 * ⭐ THE GATES ON ONE ROLLOUT THAT ARE NOT ANOTHER ROLLOUT. (2026-10-08, the
 * rollout Gates tab — what used to be its Dependencies tab.)
 *
 * The tab's graph draws every kind of gate on one rollout, both directions.
 * Rollout-to-rollout gates (promotion order, service contracts) are EDGES of
 * `buildRolloutGraph` and stay there. This module adds the gates that have no
 * second rollout on the far end — the ones `dependency-graph.ts` already
 * records on the node as `holds` and never draws as a box:
 *
 *   · a deploy window or freeze (`RolloutSchedule` / `ClusterRolloutSchedule`
 *     matching this rollout), drawn EVEN WHILE OPEN — the window exists and
 *     the reader is owed when it next changes;
 *   · an external `RolloutGate` (hand-authored or third-party: an approval, a
 *     change-freeze flag), drawn whether or not it holds anything;
 *   · the health checks, ONLY while they hold a build (the controller's
 *     promotion loop short-circuits on them — `health-witness.ts`);
 *   · a pin, which outranks every gate (`blockingStory` returns no gates at
 *     all while one is set, so without it the box column would say nothing
 *     holds a rollout that cannot move).
 *
 * ⛔ THIS MODULE NEVER DECIDES WHETHER A GATE HOLDS. The answer is the focus
 * node's `holds` (`buildRolloutGraph` → `blockingStory` → `promotionBlock`),
 * the same predicate that colours every edge and every banner, so a box and
 * the Overview's held banner cannot disagree. A gate here is `blocked` iff its
 * name is in `focus.holds`; otherwise `clear` when the controller published a
 * summary for it, `unknown` when it did not. The one exception is health,
 * which is not a gate object at all and so is never in `holds`: it is the
 * controller's own `healthGateCounts` rule, exactly as rollout detail draws it.
 *
 * Every hold is drawn: a hold no box claimed (a gate whose object this page
 * was not served) gets a box of its own from the hold itself.
 *
 * PURE. Tested without a DOM (`rollout-gates.test.ts`).
 */
import type { HealthCheck, Rollout, RolloutGate } from '../../types';
import type { GraphNode, NodeHold } from './dependency-graph';
import { candidatesHeldByGate, gateAllows, promotionCandidates, type ReleaseRef } from './promotion';
import {
	classifyCheck,
	deployWindowStart,
	healthGateCounts,
	healthGateCountsLabel,
	healthHolds,
	visibleHealthChecks
} from './health-witness';
import { getDisplayVersion } from '$lib/utils';
import { displayVersionForTag } from '../version-utils';
import { formatTransitionAt } from '$lib/api/schedules';

export type GateBoxKind = 'schedule' | 'freeze' | 'approval' | 'gate' | 'health' | 'pin';
export type GateBoxState = 'blocked' | 'clear' | 'unknown';

export type GateBox = {
	/** Stable across updates: `schedule:<name>`, `gate:<name>`, `health`, `pin`. */
	key: string;
	kind: GateBoxKind;
	state: GateBoxState;
	/** Line one — the object's own name (`Business hours`, `Release approval`). */
	title: string;
	/**
	 * The KIND word (`Deploy window`, `Freeze`, `Approval`, `Gate`). `null`
	 * when the title already is the kind word, so line two never says it twice.
	 */
	kindWord: string | null;
	/** What the gate says right now, in plain words: `open now · closes Fri 18:00 CEST`. */
	phrase: string;
	/** Display versions of THIS rollout's builds it holds, newest first. Empty unless blocked. */
	held: string[];
	/** For `gateMark` (`GateRecord.svelte`): the product's one icon rule per kind. */
	mark: { kind: 'schedule' | 'approval' | 'check' | 'unknown'; clears: 'clock' | 'person' | 'check' | 'unknown' | 'pin' };
	/** The Kubernetes names behind the box, for a tooltip. Never a headline. */
	gates: string[];
	/** Set for a promotion gate (`gateLabel`): the box DRAWS it by kind (the promotion glyph and the source chip, or the word "Promotion"); `title` is then only the plain-text form. Absent for every other box. */
	label?: GateLabel;
};

export type ScheduleLike = {
	metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> };
	spec?: { action?: 'Allow' | 'Deny'; timezone?: string };
	status?: { active?: boolean; nextTransition?: string; managedGates?: string[] };
};

const SCHEDULE_LABEL = 'gate.kuberik.com/schedule-name';
const SCHEDULE_OWNERS = new Set(['RolloutSchedule', 'ClusterRolloutSchedule']);
/** Writers whose gates are EDGES (another rollout on the far end). */
const EDGE_OWNERS = new Set(['Environment', 'RolloutDependency']);

const KIND_ORDER: Record<GateBoxKind, number> = {
	pin: 0,
	schedule: 1,
	freeze: 1,
	approval: 2,
	gate: 3,
	health: 4
};

export { humanizeGateName, isGeneratedGateName, gateDisplayName, resolveGateName, prettyNameOf } from './gate-name';
import { gateDisplayName, prettyNameOf } from './gate-name';
import { gateLabel, gateLabelText, type GateLabel } from './gate-label';
import { isApprovalLike } from './place-verdict';
import { pinnedByWho } from './pin-hold';

/** `b-44, b-45` / `b-43, b-44 +2` — the link box's own short-list rule. */
export function shortList(builds: string[]): string {
	if (builds.length <= 2) return builds.join(', ');
	return `${builds.slice(0, 2).join(', ')} +${builds.length - 2}`;
}

const display = (cs: ReleaseRef[]) => [
	...new Set(cs.map((c) => getDisplayVersion(c as { version?: string; revision?: string; tag: string })))
];

/**
 * ⭐ THE SCHEDULE'S IDENTITY, READABLE FROM THE GATE OBJECT ALONE — NO
 * `/schedules` FETCH REQUIRED. (2026-10-08, QA finding, item 1.) This is
 * what makes `scheduleKeyFor` below safe to call before `args.schedules`
 * has loaded: a gate's ownership (or its pretty-name label) is published on
 * the GATE itself, which arrives with the rest of the rollout's detail
 * payload — the schedule CR's own status (`nextTransition`, `active`) is
 * the only part that is genuinely late.
 *
 * `RolloutSchedule` is namespaced — its owner reference never crosses a
 * namespace, so it shares the gate's own. `ClusterRolloutSchedule` is
 * cluster-scoped and carries none. A label-only match (no owner ref at all)
 * cannot say which kind it is; namespaced is the common case for a
 * hand-labelled gate, so that is the assumption, same as the schedule loop's
 * own `managed.has(`${ns}/${g}`)` check already assumes.
 */
function scheduleOwnerOf(gate: RolloutGate | undefined): { namespace: string | undefined; name: string } | null {
	const owner = (gate?.metadata?.ownerReferences ?? []).find((o) => SCHEDULE_OWNERS.has(o?.kind ?? ''));
	if (owner?.name) {
		return { namespace: owner.kind === 'RolloutSchedule' ? gate?.metadata?.namespace : undefined, name: owner.name };
	}
	const labelName = gate?.metadata?.labels?.[SCHEDULE_LABEL];
	return labelName ? { namespace: gate?.metadata?.namespace, name: labelName } : null;
}

function scheduleOfGate(gate: RolloutGate | undefined): string | null {
	return scheduleOwnerOf(gate)?.name ?? null;
}

function isScheduleGate(gate: RolloutGate | undefined): boolean {
	return scheduleOfGate(gate) !== null;
}

/**
 * The ONE key format a schedule-owned gate box ever uses, whether it is
 * drawn from the loaded `RolloutSchedule`/`ClusterRolloutSchedule` status
 * (the SCHEDULES loop below) or, before that status has arrived, from the
 * hold alone (the HOLDS-fallback loop) — see `scheduleOwnerOf`'s own
 * comment. Same key either way is what `RetainedRows` (`stable-order.ts`,
 * via `RolloutNeighbourhood.svelte`'s `gateRetainer`) needs to never see a
 * schedule box "disappear" the instant its real data lands: before this fix
 * the fallback keyed by the raw gate name (`gate:<name>`) and the loaded
 * path keyed by the schedule (`schedule:<ns>/<name>`), so the retainer saw
 * the old key vanish and kept drawing it — marked "released", captioned
 * "passing now" — right beside the real, newly-claimed box for the same
 * schedule. One key, computed from information that is never late, closes
 * that window entirely.
 */
function scheduleKey(namespace: string | undefined, name: string): string {
	return `schedule:${namespace ?? ''}/${name}`;
}

function isEdgeGate(gate: RolloutGate | undefined): boolean {
	return (gate?.metadata?.ownerReferences ?? []).some((o) => EDGE_OWNERS.has(o?.kind ?? ''));
}

/**
 * The schedule's own words for its state — `scheduleMetaText`'s grammar
 * (`api/schedules.ts`), one schedule at a time: an Allow window that is open
 * closes next, a closed one opens; a Deny freeze in effect lasts until its
 * transition, an idle one starts at it. The instant is `formatTransitionAt`
 * (the reader's Local/UTC preference, zone named — `lib/CLAUDE.md`).
 */
export function schedulePhrase(s: ScheduleLike, now: Date = new Date()): string {
	const active = s.status?.active === true;
	const when = s.status?.nextTransition ? formatTransitionAt(s.status.nextTransition, now) : '';
	if (s.spec?.action === 'Deny') {
		if (active) return when ? `until ${when}` : 'in effect';
		return when ? `starts ${when}` : 'not in effect';
	}
	if (active) return when ? `open now · closes ${when}` : 'open now';
	return when ? `opens ${when}` : 'closed';
}

/**
 * ONE GATE, ONE BOX. A retained box (one that dropped off the live list, see `RetainedRows`) is superseded when a LIVE box now claims every gate it
 * drew: the first frame draws a hold no box claims under the gate's own name (the schedules have not loaded), and when the schedule arrives its box
 * claims the same gate under its window's name. Joined on `GateBox.gates` (the typed gate identities), never on a title or a key.
 */
export function withoutSupersededBoxes<B extends { gates: string[] }>(
	retained: readonly { row: B; resolved: boolean }[],
	live: readonly B[]
): { row: B; resolved: boolean }[] {
	const claimed = new Set(live.flatMap((b) => b.gates));
	return retained.filter(({ row, resolved }) => !(resolved && row.gates.length > 0 && row.gates.every((g) => claimed.has(g))));
}

export function rolloutGateBoxes(args: {
	/** The focus node of `buildRolloutGraph` — its `holds` are the authority. */
	focus: GraphNode | null;
	rollout: Rollout | null | undefined;
	/** `RolloutGate` objects on this rollout (the detail payload's `rolloutGates`). */
	rolloutGates: RolloutGate[];
	/** Schedules matching this rollout; `null` while that request is in flight. */
	schedules: ScheduleLike[] | null;
	/** Health checks selected by this rollout; `null` while unknown / not selected. */
	healthChecks: HealthCheck[] | null;
	/** Gate names already drawn as edges into the focus (never boxed twice). */
	edgeGates: Set<string>;
	now?: Date;
}): GateBox[] {
	const { focus, rollout } = args;
	if (!focus || !rollout) return [];
	const now = args.now ?? new Date();
	const holds = new Map<string, NodeHold>(focus.holds.map((h) => [h.gate, h] as const));
	const summaries = new Map(
		(rollout.status?.gates ?? []).filter((g) => g?.name).map((g) => [g.name as string, g] as const)
	);
	const objects = new Map(
		args.rolloutGates.filter((g) => g?.metadata?.name).map((g) => [g.metadata!.name as string, g] as const)
	);
	const pinned = rollout.spec?.wantedVersion ?? null;
	const claimed = new Set<string>();
	const out: GateBox[] = [];

	const stateOf = (names: string[]): GateBoxState => {
		if (names.some((n) => holds.has(n))) return 'blocked';
		if (names.length > 0 && names.some((n) => summaries.has(n))) return 'clear';
		return 'unknown';
	};
	const heldBy = (names: string[]) =>
		display(names.filter((n) => holds.has(n)).flatMap((n) => candidatesHeldByGate(rollout, n)));

	// ── PIN ──────────────────────────────────────────────────────────────
	if (pinned) {
		const candidates = promotionCandidates(rollout);
		const build = displayVersionForTag(rollout, pinned) || pinned;
		const who = pinnedByWho(rollout);
		out.push({
			key: 'pin',
			kind: 'pin',
			state: candidates.length > 0 ? 'blocked' : 'clear',
			title: who ? `Pinned to ${build} by ${who}` : `Pinned to ${build}`,
			kindWord: null,
			phrase: `to ${build} until the pin is cleared`,
			held: candidates.length > 0 ? display(candidates) : [],
			mark: { kind: 'approval', clears: 'pin' },
			gates: []
		});
		claimed.add(pinned);
	}

	// ── SCHEDULES ────────────────────────────────────────────────────────
	const ns = rollout.metadata?.namespace ?? '';
	for (const s of args.schedules ?? []) {
		const sName = s.metadata?.name ?? '';
		if (!sName) continue;
		const managed = new Set(s.status?.managedGates ?? []);
		// RolloutSchedule lists `name`, ClusterRolloutSchedule `namespace/name`.
		const mine = [...new Set([...objects.keys(), ...summaries.keys()])].filter(
			(g) =>
				managed.has(g) ||
				managed.has(`${ns}/${g}`) ||
				scheduleOfGate(objects.get(g)) === sName
		);
		mine.forEach((g) => claimed.add(g));
		const deny = s.spec?.action === 'Deny';
		const kindWord = deny ? 'Freeze' : 'Deploy window';
		const pretty = prettyNameOf(s.metadata);
		let state = stateOf(mine);
		// No gate of it on this rollout yet: the schedule itself is the only
		// evidence. Open / not in effect cannot hold anything; closed can, but
		// we cannot say which build without the gate, so it is unread.
		if (mine.length === 0) {
			const blocking = deny ? s.status?.active === true : s.status?.active !== true;
			state = blocking && promotionCandidates(rollout).length > 0 ? 'unknown' : 'clear';
		}
		out.push({
			key: scheduleKey(s.metadata?.namespace, sName),
			kind: deny ? 'freeze' : 'schedule',
			state,
			title: pretty ?? kindWord,
			kindWord: pretty ? kindWord : null,
			phrase: schedulePhrase(s, now),
			held: state === 'blocked' ? heldBy(mine) : [],
			mark: { kind: 'schedule', clears: 'clock' },
			gates: mine
		});
	}

	// ── EXTERNAL GATES ───────────────────────────────────────────────────
	const names = [...new Set([...objects.keys(), ...summaries.keys()])].sort();
	for (const g of names) {
		if (claimed.has(g) || args.edgeGates.has(g)) continue;
		const obj = objects.get(g);
		if (isEdgeGate(obj) || isScheduleGate(obj)) continue;
		// A gate summary with no object and no hold is an edge whose CRD this
		// page cannot see (a promotion gate of an Environment in a namespace
		// the list did not serve). Not ours to draw.
		if (!obj && !holds.has(g)) continue;
		claimed.add(g);
		const sum = summaries.get(g);
		const allowed = sum?.allowedVersions ?? obj?.spec?.allowedVersions ?? null;
		const passing = sum?.passing ?? obj?.spec?.passing;
		/* an allow-list says what the gate lets through, not what it IS: it is an approval only by the one predicate every surface reads (`isApprovalLike`: `kind`, a name only when the payload carries no kind). A hand-written allow-list of unknown kind is a gate with a list. */
		const listed = Array.isArray(allowed);
		const approval = isApprovalLike({ name: g, kind: sum?.kind ?? null, allowedVersions: listed ? allowed : null });
		const state = stateOf([g]);
		const candidates = promotionCandidates(rollout);
		let phrase: string;
		if (listed) {
			const ok = display(candidates.filter((c) => allowed!.includes(c.tag ?? '')));
			const refused = display(candidates.filter((c) => !allowed!.includes(c.tag ?? '')));
			phrase =
				candidates.length === 0
					? 'nothing waiting'
					: ok.length > 0
						? `allows ${shortList(ok)}`
						: `not given for ${shortList(refused)}`;
		} else {
			phrase = passing === false ? 'not passing' : 'passing';
		}
		const pretty = prettyNameOf(obj?.metadata) ?? sum?.displayName;
		/* a promotion gate is named by kind, never by the sentence the environment controller published (gate-label.ts) */
		const label = gateLabel({ kind: sum?.kind ?? null, name: g }, pretty);
		const title = label.kind === 'promotion' ? gateLabelText(label) : gateDisplayName(g, pretty);
		const kindWord = approval ? 'Approval' : 'Gate';
		out.push({
			key: `gate:${g}`,
			kind: approval ? 'approval' : 'gate',
			state,
			title,
			kindWord: label.kind === 'promotion' ? null : title.toLowerCase() === kindWord.toLowerCase() ? null : kindWord,
			phrase,
			held: state === 'blocked' ? heldBy([g]) : [],
			mark: approval ? { kind: 'approval', clears: 'person' } : listed ? { kind: 'unknown', clears: 'unknown' } : { kind: 'check', clears: 'check' },
			gates: [g],
			...(label.kind === 'promotion' ? { label } : {})
		});
	}

	// ── HOLDS NO BOX CLAIMED ─────────────────────────────────────────────
	for (const h of focus.holds) {
		if (claimed.has(h.gate) || args.edgeGates.has(h.gate)) continue;
		claimed.add(h.gate);
		// ⭐ ITEM 1's FIX. A schedule-owned gate drawn here (its schedule's own
		// status hasn't loaded yet) MUST use the exact key the SCHEDULES loop
		// above will use once it has — `scheduleOwnerOf` reads that identity
		// off the gate object itself, which is never late. See `scheduleKey`'s
		// own comment for the duplicate-box defect this closes. It also beats
		// `h.clears === 'clock'` as the "is this a schedule" test: without the
		// schedule's own status loaded, `blockingStory`'s `classifyGate` has
		// no join to classify it through and falls back to `clears: 'check'`
		// even though the gate's OWN owner reference already says otherwise.
		const owner = scheduleOwnerOf(objects.get(h.gate));
		const clock = h.clears === 'clock' || owner !== null;
		const holdLabel = clock ? null : gateLabel({ kind: summaries.get(h.gate)?.kind ?? null, name: h.gate }, prettyNameOf(objects.get(h.gate)?.metadata) ?? summaries.get(h.gate)?.displayName);
		out.push({
			key: owner ? scheduleKey(owner.namespace, owner.name) : `gate:${h.gate}`,
			kind: clock ? 'schedule' : 'gate',
			state: 'blocked',
			title: clock ? 'Deploy window' : gateLabelText(holdLabel!),
			kindWord: null,
			phrase: h.short.charAt(0).toLowerCase() + h.short.slice(1),
			held: heldBy([h.gate]),
			mark: clock
				? { kind: 'schedule', clears: 'clock' }
				: h.clears === 'person'
					? { kind: 'approval', clears: 'person' }
					: h.clears === 'check'
						? { kind: 'check', clears: 'check' }
						: { kind: 'unknown', clears: 'unknown' },
			gates: [h.gate],
			...(holdLabel?.kind === 'promotion' ? { label: holdLabel } : {})
		});
	}

	// ── HEALTH CHECKS, ONLY WHILE THEY HOLD ──────────────────────────────
	// ⭐ PIN OUTRANKS EVERY GATE, APPLIED HERE RATHER THAN INSIDE `healthHold`.
	// (Item 3.) The PIN box above already covers every newer build with ONE
	// reason (`to <build> until the pin is cleared`); a health box for the
	// identical set would be a second, redundant reason sitting right next to
	// it. Rollout detail reaches the same outcome with its template's
	// `{#if blockStory.pinnedTo} … {:else if newestHeldByHealth}` — one slot,
	// pin wins. This graph has no single slot to fall through, so the box is
	// simply never pushed when a pin is set. `healthHold` itself stays
	// pin-agnostic, matching `newestHeldByHealth` exactly — see its own doc
	// comment on `healthHolds` for why.
	if (!pinned) {
		const health = healthHold(rollout, args.healthChecks);
		if (health) out.push(health);
	}

	return out.sort(
		(a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title)
	);
}

/**
 * ⭐ THE HEALTH BOX, OR `null`. Must stay IDENTICAL to rollout detail's
 * `newestHeldByHealth` (`+page.svelte` ~lines 816-870) — the same fact drawn
 * twice must never disagree. Both now read the shared `healthHolds`
 * predicate (`health-witness.ts`) over the same three ingredients:
 *
 *   · a newest candidate to hold back at all (`promotionCandidates(rollout)[0]`,
 *     detail's `releaseCandidates?.[0]`);
 *   · that candidate is NOT already refused by a real gate (`gateAllows`,
 *     mirroring detail's `getBlockingGates` verbatim — see that export's own
 *     comment) — THE CLAUSE THIS FUNCTION USED TO SKIP ENTIRELY, which let a
 *     gate-explained hold print a second, independent "held by health" box
 *     for the same build;
 *   · `healthGateCounts` over `visibleHealthChecks` (stale, pre-deploy
 *     failures dropped) says something is failing or pending.
 *
 * Pin is NOT checked here — see the call site's own comment, immediately
 * above, for why that precedence belongs one level up.
 */
export function healthHold(
	rollout: Rollout | null | undefined,
	healthChecks: HealthCheck[] | null
): GateBox | null {
	if (!rollout || !healthChecks) return null;
	const candidates = promotionCandidates(rollout);
	const newest = candidates[0];
	if (!newest) return null;
	const tag = newest.tag ?? newest.version ?? newest.revision ?? '';
	const newestBlockedByGate = (rollout.status?.gates ?? []).some((g) => !gateAllows(g, tag));
	const since = deployWindowStart(rollout);
	const visible = visibleHealthChecks(healthChecks, since);
	const counts = healthGateCounts(visible, since);
	if (!healthHolds(true, newestBlockedByGate, counts)) return null;
	return {
		key: 'health',
		kind: 'health',
		state: 'blocked',
		title: 'Health checks',
		kindWord: null,
		phrase: healthGateCountsLabel(counts),
		held: display(candidates),
		mark: { kind: 'check', clears: 'check' },
		gates: visible
			.filter((hc) => classifyCheck(hc, since) === 'failing' || classifyCheck(hc, since) === 'pending')
			.map((hc) => hc.metadata?.name ?? '')
			.filter(Boolean)
	};
}
