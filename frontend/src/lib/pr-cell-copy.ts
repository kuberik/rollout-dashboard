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
import type { PrCell } from './view-models/pr-pipeline';
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
 * The bold, fixed-vocabulary label for `cell.state`. One of the shapes the
 * PR-lane task names: "not built yet", "gated by <name>", "pinned to
 * <label>", "waiting on <service/env>", "deploying", "baking"/"baking · N
 * of M min", "retrying", "failed", "cancelled", "rolled back to <label>",
 * "live since <T>" / "live (since before recorded history)".
 */
export function cellStateSentence(cell: PrCell, now: Date = new Date()): string {
	switch (cell.state) {
		case 'not-built':
			return 'not built yet';
		case 'gated':
			// `gateLabel` is null on exactly one path (`pr-pipeline.ts`'s
			// "no blocking gate at all, just not promoted" branch) — a
			// distinct fact from "held by a named rule" and worded as one.
			return cell.gateLabel ? `gated by ${cell.gateLabel}` : 'ready, not promoted yet';
		case 'pinned':
			// Already exactly "pinned to <label>" — see `pr-pipeline.ts`.
			return cell.reason;
		case 'waiting-upstream':
			return `waiting on ${cell.gateSubject ?? 'its upstream'}`;
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
		return cell.superseded
			? 'a later build that also carries this PR has since shipped'
			: null;
	}
	if (!cell.reason) return null;
	if (REDUNDANT_REASON.has(cell.reason)) return null;
	const sentence = cellStateSentence(cell, now);
	if (cell.reason.trim().toLowerCase() === sentence.trim().toLowerCase()) return null;
	return cell.reason;
}

/** `"usually 12 min"`, or an em dash under the view-model's own 2-sample
 *  guard (`cell.usuallyMs === null`) — never render an unresolvable
 *  comparison as a claim. */
export function usuallyLabel(ms: number | null): string {
	if (ms == null) return '—';
	const minutes = Math.max(1, Math.round(ms / 60000));
	return `usually ${minutes} min`;
}

/** The row's trailing "time since" column — the compact "2h ago" form, or
 *  `null` when the cell names no instant at all (e.g. `pinned`, `gated`,
 *  `not-built`, or `live` with no recorded history). */
export function sinceLabel(cell: PrCell, now: Date = new Date()): string | null {
	if (!cell.since) return null;
	return agoCompact(cell.since, now);
}
