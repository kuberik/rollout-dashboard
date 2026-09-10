/**
 * THE PR PIPELINE CARD'S ROW COPY — the fixed-vocabulary "state sentence"
 * and the muted "reason" beside it, split into one pure, testable module so
 * `PipelineCard.svelte` only renders what this computes.
 *
 * ── WHY A SENTENCE SEPARATE FROM `cell.reason` ────────────────────────────
 *
 * `pr-pipeline.ts`'s `PrCell.reason` is the "why" a controller or this VM
 * already computed (a gate's own clause, a bake-status message, a pin
 * target) — free-form, one sentence fragment. The card's row grammar wants
 * a SECOND, fixed-vocabulary label first ("not built yet", "gated by X",
 * "baking · 4 of 10 min") so a reader can scan the state column without
 * parsing prose, with the specific "why" following in muted text. Fusing
 * the two into one string would mean inventing a template per state that
 * `reason`'s free text does not always fit (`baking`'s "N of M min" is
 * computed from `bakeLeftMs`, not from any string `pr-pipeline.ts` emits).
 *
 * ── "BAKING", DELIBERATELY NOT `bake-status.ts`'S "CHECKING" ──────────────
 *
 * `bake-status.ts`'s own hard rule (2026-08-30) renamed the `InProgress`
 * bake-status word to `checking` product-wide ("spelling it two ways is the
 * defect being closed"). This page is the one deliberate exception: the
 * design doc's own approved example — and `pr-pipeline.test.ts`'s
 * `furthest`/`verdict` fixtures, already shipped and passing — spell it
 * `"live in dev · baking in staging"` / `"Baking in staging"`. Since the
 * card's per-row sentence sits directly under that same rollup, it uses the
 * SAME word the rollup already ships, rather than opening a second
 * inconsistency (checking in the row, baking 20px above it in the header)
 * to chase a rule this specific page was reviewed and tested against
 * spelling differently. Flagged to the tech lead as a known divergence from
 * `bake-status.ts`'s vocabulary, not silently reconciled.
 *
 * `failed`/`cancelled` follow the same reasoning — `pr-pipeline.ts`'s own
 * `STATE_VERB` table (which builds `furthest`/`verdict`) spells them
 * `failed`/`cancelled`, not `bake-status.ts`'s `deploy failed`/`stopped`.
 *
 * ── ONE FACT, DRAWN, IS THE END OF ITS SENTENCE (`lib/CLAUDE.md`) ─────────
 *
 * `cellReasonText` returns `null` whenever the muted line would only repeat
 * what the sentence already said — a pinned cell's `reason` IS "pinned to
 * X", a rolled-back cell with no custom message IS "rolled back to X", a
 * `baking` cell's own elapsed/total is already in the sentence. It renders
 * text only where it adds something the sentence does not carry.
 */
import type { PrCell, PrState } from './view-models/pr-pipeline';
import type { PrChecks } from './api/pulls';
import { formatTimeAgoCompact } from './utils';

/**
 * `"2h ago"`, not `formatTimeAgo`'s long-word form — the compact spelling
 * every other dense row already uses (`revisions/[...slug]/+page.svelte`'s
 * `slotDeployedAgo`, its own comment: *"THE COMPACT FORM... NOT THE
 * FULL-WORD FORM. This page printed [long form] and it read as prose in a
 * table."*). A card row is the same shape.
 */
function agoCompact(iso: string, now: Date): string {
	return `${formatTimeAgoCompact(iso, now)} ago`;
}

/** Exact fallback strings `pr-pipeline.ts` emits when no controller message
 *  is present — redundant with the fixed sentence, so `cellReasonText`
 *  suppresses them rather than repeating the state word a second time. */
const REDUNDANT_REASON: ReadonlySet<string> = new Set([
	'not built here yet',
	// ⭐ ROUND 3 (2026-09-10 ruling A). `cellStateSentence` speaks this reason
	// as "release status unknown" now (see its own doc) — the string no
	// longer matches literally, so it needs its own redundancy entry to stay
	// suppressed rather than printing the raw internal reason underneath.
	'not built (unverified)',
	'deploying now',
	'retrying the bake',
	'the bake failed',
	'the bake was cancelled'
]);

function bakingSentence(cell: PrCell, now: Date): string {
	const word = 'baking';
	if (cell.bakeLeftMs == null || !cell.since) return word;
	const start = new Date(cell.since).getTime();
	if (!Number.isFinite(start)) return word;
	const elapsedMs = now.getTime() - start;
	const totalMs = elapsedMs + cell.bakeLeftMs;
	if (totalMs <= 0) return word;
	const elapsedMin = Math.max(0, Math.round(elapsedMs / 60000));
	const totalMin = Math.max(elapsedMin, Math.round(totalMs / 60000));
	return `${word} · ${elapsedMin} of ${totalMin} min`;
}

/**
 * The bold, fixed-vocabulary label for `cell.state`. One of the shapes:
 * "held by <name>"/"held by a rule", "pinned to <label>", "waiting for
 * <env> to deploy it first", "waiting on <service>", "promoting shortly",
 * "deploying", "baking"/"baking · N of M min", "retrying", "failed",
 * "cancelled", "rolled back to <label>", "live since <T>" / "live (since
 * before recorded history)", "release status unknown"/"no release yet".
 *
 * ⚠️ `opts.builtElsewhere` IS NOW UNUSED (⭐ ROUND 3, 2026-09-10 ruling A).
 * `PrService.builtElsewhere` has been largely superseded by
 * `buildPrPipeline`'s own eligibility filter (a service with no release
 * evidence never reaches `PipelineCard` at all — see `pr-pipeline.ts`'s
 * `unaffectedServices`), so "no build of this change for THIS service" is
 * retired copy. The parameter stays on the signature, optional, so no
 * existing call site needs an edit; a future pass may drop it outright.
 */
export function cellStateSentence(
	cell: PrCell,
	now: Date = new Date(),
	opts?: { builtElsewhere?: boolean }
): string {
	switch (cell.state) {
		case 'not-built':
			// ⭐ ROUND 3 (2026-09-10 ruling A, "NO RELEASE MEANS NOT AFFECTED").
			// "not built yet" and "no build of this change for this service"
			// are RETIRED copy — `buildPrPipeline` only ever keeps a service
			// when it has release evidence, and recasts every genuine "no
			// candidate for this env" cell to `queued` (see
			// `pr-pipeline.ts`'s `remapForIncludedService`), so a real
			// included service never reaches this branch with that reason any
			// more. The one surviving `not-built` reading is ruling 1's own
			// honesty guard — a candidate this VM found but cannot yet PROVE
			// carries the change (`containmentKnown` false) — spoken here as
			// "release status unknown", never a claim this service has no
			// build at all.
			return cell.reason === 'not built (unverified)' ? 'release status unknown' : 'no release yet';
		case 'gated':
			// ⭐ ITEM 3 (2026-09-10 fix pass). Retired: "gated by X" (the noun
			// `gate` is retired from user copy) and printing the raw
			// Kubernetes gate id when `pr-pipeline.ts` could not resolve a
			// trustworthy label (`gatePending`) — both shipped live as
			// "gated by schedule-gate-fk44d". `gateLabel` is null exactly
			// when the rule is unresolved (schedule join pending, or an
			// unverified approval/unknown classification) — the honest,
			// generic "held by a rule" until the row's "why" disclosure
			// resolves the specific one.
			//
			// ⭐ ROUND 3, ITEM 1(e) (2026-09-10 fix pass) — "HELD FOR
			// APPROVAL", BEFORE THE NAME RESOLVES. `gateApprovalGuess` is
			// this VM's own best guess (see its own doc comment) — trusted
			// enough for the GENERIC word, never for a specific rule name.
			// `PipelineRow.svelte` appends "· <name>" once its own lazy
			// fetch (which DOES carry `rolloutGates`) confirms the guess and
			// resolves a pretty name.
			return cell.gateLabel
				? `held by ${cell.gateLabel}`
				: cell.gateApprovalGuess
					? 'held for approval'
					: 'held by a rule';
		case 'pinned':
			// Already exactly "pinned to <label>" — see `pr-pipeline.ts`.
			return cell.reason;
		case 'waiting-upstream':
			// ⭐ FIX PASS ITEM 4 (2026-09-10) — a `waiting-upstream` cell is now
			// ALWAYS the service-subject dependency wait ("waiting on
			// hello-api-app"); the environment-subject promotion-order case
			// this used to also spell here is its own state now (`queued`,
			// below) — see `PrState`'s own doc comment for why the two split.
			return `waiting on ${cell.gateSubject ?? 'its upstream'}`;
		case 'queued':
			// The normal promotion-order wait — "dev" not "hello-api-app" — a
			// service simply hasn't been given its turn yet, nobody blocking
			// anything.
			return `waiting for ${cell.gateSubject ?? 'its upstream'} to deploy it first`;
		case 'promoting':
			return 'promoting shortly';
		case 'deploying':
			return 'deploying';
		case 'baking':
			return bakingSentence(cell, now);
		case 'retrying':
			return 'retrying';
		case 'failed':
			return 'failed';
		case 'cancelled':
			return 'cancelled';
		case 'rolled-back':
			return `rolled back to ${cell.releaseLabel}`;
		case 'live':
			return cell.since ? `live since ${agoCompact(cell.since, now)}` : cell.reason;
		default:
			return cell.reason;
	}
}

/**
 * The muted secondary text, or `null` when it would only restate the
 * sentence above. `baking` never has one (its whole "why" — elapsed vs.
 * budget — is already in the sentence); `live` shows only the ONE extra
 * fact the sentence cannot carry (`superseded`).
 */
export function cellReasonText(cell: PrCell, now: Date = new Date()): string | null {
	if (cell.state === 'baking') return null;
	if (cell.state === 'live') {
		return cell.superseded ? 'a later build that also carries this change has since shipped' : null;
	}
	if (!cell.reason) return null;
	if (REDUNDANT_REASON.has(cell.reason)) return null;
	const sentence = cellStateSentence(cell, now);
	if (cell.reason.trim().toLowerCase() === sentence.trim().toLowerCase()) return null;
	return cell.reason;
}

/**
 * ⭐ CHANGES-2026-09-10 FIX PASS, ITEM 2 ("JOIN THE REASON REACHES THE
 * READER"). `joinDependencyReasons` (`pr-pipeline.ts`, RULING 4) sets a
 * `waiting-upstream` cell's `reason` to the SUBJECT clause plus an added
 * fact, joined with " — " — `"waiting on hello-api-app — its build of this
 * change does not exist yet"`. That subject clause is byte-identical to
 * `cellStateSentence`'s own "waiting on <subject>" — so a caller that
 * already draws the sentence once (a folded card row naming several
 * environments, `HeldBanner`'s single message line) must not glue the raw
 * `cellReasonText` on afterward, or the subject repeats
 * ("waiting on hello-api-app … waiting on hello-api-app — its build…").
 * This strips the shared subject prefix, returning ONLY the added fact
 * ("its build of this change does not exist yet") for such a caller to
 * append after its own "in dev · staging · prod" tail. `null` when the
 * reason carries no such prefix-shared tail (a plain reason, a redundant
 * one `cellReasonText` already suppressed, or the promotion-order
 * "waiting on X to reach Y" variant, which is one clause, not two — nothing
 * to safely split off). `PipelineRow`'s own per-cell rendering is
 * unaffected: it keeps drawing `cellStateSentence` and `cellReasonText`
 * side by side, exactly as it already did.
 */
export function reasonTail(cell: PrCell, now: Date = new Date()): string | null {
	const reason = cellReasonText(cell, now);
	if (!reason) return null;
	const sentence = cellStateSentence(cell, now);
	const sep = ' — ';
	const prefix = `${sentence}${sep}`;
	if (!reason.toLowerCase().startsWith(prefix.toLowerCase())) return null;
	return reason.slice(prefix.length);
}

/** `"usually 12 min"`, or an em dash under the view-model's own 2-sample
 *  guard (`cell.usuallyMs === null`) — never render an unresolvable
 *  comparison as a claim. */
export function usuallyLabel(ms: number | null): string {
	if (ms == null) return '—';
	const minutes = Math.max(1, Math.round(ms / 60000));
	return `usually ${minutes} min`;
}

/**
 * ⭐ ITEM 1 (CHANGES-2026-09-10 §7). The FRONTIER cell's own estimate for a
 * cell that has not started yet (held, not-built, promoting…) — "with a time
 * estimation" answered where the question is actually asked, not only on a
 * cell already in flight (`usuallyLabel`'s bare "usually N min", which reads
 * naturally once a bake is already running). `null` under the same 2-sample
 * guard `usuallyLabel` honours — never a bare em dash, per the design doc's
 * own instruction; callers render nothing at all rather than call this with
 * a null. Every OTHER (non-frontier) cell stays silent, by the caller simply
 * never invoking this off it — the silence is the caller's job, not this
 * function's.
 */
export function frontierUsuallyLabel(ms: number): string {
	const minutes = Math.max(1, Math.round(ms / 60000));
	return `usually ${minutes} min once it starts`;
}

/**
 * ⭐ RULING 2 (CHANGES-2026-09-10 fix pass, "NOT-BUILT HAS NO ETA"), NARROWED
 * ⭐ ROUND 3 (2026-09-10, third operator walk, "NO TIMER IS COUNTING THIS
 * DOWN"). `gated`/`pinned`/`waiting-upstream` used to print this too, which
 * read as an ETA on a hold nothing is actually counting down — live bug:
 * PR #4's own dependency wait on `api ^1.68.0` (a version nobody has
 * released) printed "usually 1 min once it starts" directly beside a
 * verdict that ALSO says "will not move on its own", a direct
 * contradiction. Only `queued` (a normal promotion-order wait — the next
 * env's own turn simply hasn't come up) and `promoting` (ready, waiting on
 * the next reconcile) are honestly ESTIMATES OF WHEN; a `gated`/`pinned`/
 * `waiting-upstream` hold clears on a rule, a human or an upstream shipping
 * something — none of which "usually N min" describes.
 *
 * A schedule-held cell with a KNOWN next opening is the one real exception
 * the design doc names ("opens in 1d 4h") — NOT implemented here, because
 * `PrCell` carries no `clearsAt`/reopen instant yet (the same gap
 * `changes.ts`'s own `frontierReason` doc already flags for the `·` tail).
 * When that field lands, its own branch belongs here, not a reopened
 * `gated` case.
 *
 * Prefer this over the raw `frontierUsuallyLabel` at any NEW call site; the
 * un-guarded function stays exported for the one existing call site that
 * already gates on state itself.
 */
const HAS_BUILD_STATES = new Set<PrState>(['queued', 'promoting']);

export function frontierUsuallyLabelForCell(cell: PrCell): string | null {
	if (!HAS_BUILD_STATES.has(cell.state)) return null;
	if (cell.usuallyMs == null) return null;
	return frontierUsuallyLabel(cell.usuallyMs);
}

/** The row's trailing "time since" column — the compact "2h ago" form, or
 *  `null` when the cell names no instant at all (e.g. `pinned`, `gated`,
 *  `not-built`, or `live` with no recorded history). */
export function sinceLabel(cell: PrCell, now: Date = new Date()): string | null {
	if (!cell.since) return null;
	return agoCompact(cell.since, now);
}

/**
 * ── APPROACH B, ITEM E — THE HEAD BAND'S ONE "TESTS" LINE ─────────────────
 *
 * ⛔ HEAD-BAND SCOPE ONLY, DELIBERATELY NOT A CELL FACT. The design doc is
 * explicit: *"the verdict says 'held by failing checks' is NOT a controller
 * fact, so do not fold it into cells — one head-band line only."* A CI check
 * run on the merge commit is a GitHub fact about the PR itself, not a
 * per-`cluster/env` state this rollout's own controller ever reasoned
 * about — folding it into `PrCell.state` would imply a gate that does not
 * exist. `+page.svelte` renders this ALONGSIDE the head band's existing
 * subtitle line, never inside `PipelineCard`/`PipelineRow`.
 *
 * ⭐ FIX PASS ITEM 8 (2026-09-10) — SUPERSEDES THE DESIGN DOC'S "NOTHING FOR
 * NONE". `'none'` now prints its own small, muted line — `'no checks
 * reported'`, never linked — instead of nothing at all: the design doc's
 * silence read as "the product never looked", when the truth is GitHub
 * told this dashboard there is nothing to check. A developer staring at a
 * change page with no checks line at all cannot tell those two apart;
 * saying so once removes the ambiguity. `success`/`pending`/`failure`
 * still get exactly one of their own three sentences, with a link to
 * GitHub's own checks tab when the backend supplied one.
 */
export type ChecksLine = { text: string; href: string | null };

export function checksLine(checks: PrChecks | null | undefined): ChecksLine | null {
	if (!checks) return null;
	switch (checks.state) {
		case 'none':
			return { text: 'no checks reported', href: null };
		case 'success':
			return { text: 'checks passing', href: checks.url ?? null };
		case 'pending':
			return { text: 'checks pending', href: checks.url ?? null };
		case 'failure': {
			// Defensive against a backend that reports `failure` with a zero
			// count (should not happen, but a printed "0 of 0 checks failing"
			// would be a worse failure than a slightly generic fallback).
			const failed = Math.max(checks.failed, 1);
			const total = Math.max(checks.total, failed);
			return { text: `${failed} of ${total} checks failing`, href: checks.url ?? null };
		}
		default:
			return null;
	}
}
