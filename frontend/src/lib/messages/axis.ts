/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * THE SUBJECT PROPERTY, AS A FUNCTION OF THE DOM.
 *
 * Shared by `subject.svelte.test.ts` (the list surfaces) and
 * `subject-detail.svelte.test.ts` (the pages that fix an axis by being about
 * one thing), so the two cannot drift into two definitions of "unambiguous".
 *
 * ── TWO GRANULARITIES, BECAUSE A READER HAS TWO ──────────────────────────
 *
 * The first version of this file had ONE resolver, `resolveAxis`, and it
 * asked: *is the axis named anywhere in the smallest region around this
 * sentence that names the axis at all?* That is the right question for a row
 * — a row is scanned as a unit, and a cell three columns left is genuinely
 * part of the same glance.
 *
 * It is the WRONG question for a HEADLINE, and it is why this suite shipped
 * one commit before the defect it was written to catch was found on `/apps`
 * by a human holding a phone. The banner rendered:
 *
 *     DEV is waiting on another deploy          ← 16px bold, the whole glance
 *     Waiting for hello-api-app to ship …       ← 14px, five lines on a phone
 *     [ Open hello-frontend-app ]               ← a button
 *
 * `resolveAxis` walked up from the headline, hit the panel, found
 * `hello-frontend-app` in the BUTTON, counted the axis supplied, and passed.
 * The headline itself — the largest type on the page, the only line a person
 * scanning at 3am actually takes in, and on a 390px phone separated from its
 * body by five wrapped lines — said `DEV`, which on a page listing four apps
 * across three environments is a claim about the ENVIRONMENT. A different and
 * false claim.
 *
 * So a headline is read ON ITS OWN, with only the context established ABOVE
 * it, and `resolveAxisAbove` is that rule made structural: when resolving an
 * axis for a read-first element, an ancestor's text counts only where it is
 * INSIDE the element or PRECEDES it in document order. A card header above a
 * row still fixes the axis for that row — that is real context a reader has
 * already passed through. A body paragraph and a call-to-action underneath do
 * not, and neither does a sibling row.
 */
import { screen } from '@testing-library/svelte';
import { APPS, TIERS, CLUSTERS } from './fleet-fixture';
import type { Axis } from './registry';

export const AXIS_VALUES: Record<Axis, string[]> = {
	app: [...APPS],
	environment: [...TIERS],
	cluster: [...CLUSTERS],
	version: ['r1aaaaa', 'r2bbbbb', 'r3ccccc']
};

/** `dev` inside `alpha-dev` counts: a row showing the namespace names it. */
export function mentions(text: string, value: string): boolean {
	return new RegExp(`(^|[^A-Za-z0-9])${value}([^A-Za-z0-9]|$)`, 'i').test(text);
}

/**
 * Walk from the sentence's own element towards `<body>` and stop at the FIRST
 * ancestor whose text carries any value of the axis. The axis is resolved iff
 * that ancestor carries exactly one.
 *
 * ROW GRANULARITY. Everything in the region counts, in any direction.
 */
export function resolveAxis(
	el: Element,
	values: string[]
): { resolved: boolean; found: string[] } {
	for (let n: Element | null = el; n; n = n.parentElement) {
		const text = n.textContent ?? '';
		const found = values.filter((v) => mentions(text, v));
		if (found.length === 0) continue;
		return { resolved: found.length === 1, found };
	}
	return { resolved: false, found: [] };
}

/**
 * ⛔ A PEER STATEMENT IS NOT CONTEXT. A HEADER IS.
 *
 * "Everything that precedes it" is too generous on its own, and generous in a
 * way that produces a FALSE PASS rather than a false alarm. `/apps` draws a
 * `Needs you` card and then an `All apps` card; the second card's rollup
 * (`2 of 2 the same version everywhere`) is preceded, in document order, by
 * the whole of the first card. If the first card happens to hold exactly one
 * app, the rollup "resolves" to that app — a rollup about the WHOLE FLEET
 * inheriting a subject from the card next door. Measured: it passed for
 * `alpha-app` before this exclusion existed.
 *
 * A preceding subtree that carries a read-first claim of its OWN is another
 * region making its own statement, not a header introducing this one. It is
 * skipped. What survives is what a header actually is: the card's own title,
 * the group's own label, the page's `<h1>` and its description.
 */
const PEER_REGION =
	/(is waiting on an approval|is waiting on another deploy|things are holding|Something is holding|is pinned to|Held on .* on purpose|is stuck|Unchanged for |Health check .* is failing|\d+ of \d+ |All on the newest|Never deployed)/;

/**
 * The text of `scope` restricted to what a reader has ALREADY READ by the
 * time their eye lands on `el`: the element's own words, plus the headers
 * above it. What comes after — the body, the button, the next row — is
 * excluded, and so is any peer region beside it.
 *
 * `ownText` overrides the element's own subtree, for a claim that lives in an
 * `aria-label` or a `title`. The accessible name REPLACES the subtree for the
 * reader who hears it, so a tooltip may not borrow the axis from the control
 * it is attached to.
 */
function textReadBy(scope: Element, el: Element, ownText?: string): string {
	const own = ownText ?? el.textContent ?? '';
	if (scope === el || el.contains(scope)) return own;
	let out = '';
	const visit = (node: Element) => {
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeType === 3 /* TEXT_NODE */) {
				// 2 === DOCUMENT_POSITION_PRECEDING: `child` comes before `el`.
				if (el.compareDocumentPosition(child) & 2) out += ' ' + (child.nodeValue ?? '');
				continue;
			}
			if (child.nodeType !== 1) continue;
			const e = child as Element;
			if (e.contains(el)) {
				visit(e);
				continue;
			}
			if (!(el.compareDocumentPosition(e) & 2)) continue; // after `el`
			if (PEER_REGION.test(e.textContent ?? '')) continue; // a peer, not a header
			visit(e);
		}
	};
	visit(scope);
	return `${out} ${own}`;
}

/**
 * READ-FIRST GRANULARITY. Same walk, same "exactly one value" rule, but each
 * ancestor is read only up to the sentence itself.
 *
 * The known cases still come out right, with no per-page special casing:
 *
 *   - `/environments`, a card headed `DEV` with one headline per app: the
 *     card header precedes the headline, so `environment` resolves at the
 *     card. Correct — the reader passed the header on the way in.
 *   - `/apps`, a page-level banner above every card: nothing above it names
 *     an app, so the headline has to name the app itself. Which is the fix.
 *   - `/apps/<name>`: the page's `<h1>` precedes everything. Resolved by the
 *     page, correctly and trivially.
 */
export function resolveAxisAbove(
	el: Element,
	values: string[],
	ownText?: string
): { resolved: boolean; found: string[] } {
	for (let n: Element | null = el; n; n = n.parentElement) {
		const text = textReadBy(n, el, ownText);
		const found = values.filter((v) => mentions(text, v));
		if (found.length === 0) continue;
		return { resolved: found.length === 1, found };
	}
	return { resolved: false, found: [] };
}

export type Claim = {
	id: string;
	re: RegExp;
	aggregates?: Axis[];
	/**
	 * ⭐ THIS SENTENCE IS READ BEFORE, AND OFTEN INSTEAD OF, WHATEVER SITS
	 * UNDER IT — a banner headline, a card header, a group header, a chip
	 * whose whole job is to be glanced at, a toast that appears and leaves,
	 * an `aria-label` a screen reader announces with no surroundings at all.
	 *
	 * A read-first claim is held to `resolveAxisAbove`: it must name its axes
	 * itself, or sit under a header that already did. It may NOT borrow them
	 * from its own body or its own button.
	 *
	 * The test for membership is not the font size, it is: *if a reader saw
	 * only this string and the headers above it, would they know what it is
	 * about?* If the answer has to be "well, the line underneath says", it is
	 * read-first and it is not doing its job.
	 */
	readFirst?: boolean;
};

/**
 * THE CLAIMS UNDER TEST -- patterns, not literals, so a rewording is still
 * caught by the same case.
 *
 * `aggregates` names an axis a claim deliberately spans. `0 of 3 on the newest`
 * is ABOUT three environments; demanding that it name one would be demanding
 * a different sentence.
 */
export const CLAIMS: Claim[] = [
	{
		id: 'blocking headline',
		re: /\b(is waiting on an approval|is waiting on another deploy|things are holding|Something is holding)\b/,
		readFirst: true
	},
	{ id: 'blocking consequence', re: /Nothing promotes itself until/ },
	{
		id: 'blocking verdict',
		re: /(This will not clear on its own|Nobody has to approve anything|cannot tell what clears this)/
	},
	{
		id: 'blocking row',
		re: /^(Waiting for [a-z]|Held by |Outside the |A check is not passing|Waiting for someone to approve it|No newer build is allowed yet|Waiting on a check or a time window)/
	},
	{ id: 'rank title', re: /can still take \d+ newer build/, readFirst: true },
	{
		id: 'deploy state word',
		re: /^(deploy succeeded|deploy failed|checking|deploying|stopped|no deploy yet)$/
	},
	{ id: 'health failure title', re: /Health check .* is failing/, readFirst: true },
	/**
	 * ── ONE OLD CLAIM, SPLIT, BECAUSE IT MATCHED TWO DIFFERENT OBJECTS ───
	 *
	 * `pin` was `/is pinned to|Held on .* on purpose/` and `stuck banner` was
	 * `/is stuck$|Unchanged for /`. Each alternation joined a HEADLINE to a
	 * BODY LINE: `/apps/<name>` renders the title `DEV is stuck` and, under
	 * it, `Unchanged for 28d. 2 newer builds are waiting…`. Marking the
	 * merged claim read-first therefore flagged the body for not naming what
	 * the title one line above it had already named -- a false alarm produced
	 * by holding a second line to a first line's rule.
	 *
	 * A claim is one object at one granularity. That is the whole lesson of
	 * this file.
	 */
	{ id: 'pin headline', re: /is pinned to|is pinned on/, readFirst: true },
	{ id: 'pin line', re: /Held on .* on purpose/ },
	{ id: 'stuck banner', re: /is stuck$/, aggregates: [], readFirst: true },
	{ id: 'stuck span', re: /Unchanged for |Unchanged long enough/, aggregates: [] },
	{
		id: 'up-to-date headline',
		re: /^(All on the newest|Never deployed|\d+ of \d+ on the newest)$/,
		aggregates: ['environment'],
		readFirst: true
	},
	/**
	 * ── THE ROLLUP A CARD HEADER CARRIES ─────────────────────────────────
	 * `Card`'s `verdict` slot. A card headed `All apps` whose rollup reads
	 * `4 of 4 the same version everywhere` has exactly the failure `/apps`'s
	 * banner had: the number is the loudest thing in the header and it is
	 * about a SET the header has to have named.
	 */
	{
		id: 'card rollup',
		re: /^\d+ of \d+ [a-z]/,
		aggregates: ['app', 'environment'],
		readFirst: true
	},
	/**
	 * ── THE EMPTY STATE ──────────────────────────────────────────────────
	 * The only sentence on the surface when it fires, so there is nothing
	 * under it to borrow from and nothing beside it to compare against.
	 */
	{
		id: 'empty state',
		re: /^(Nothing to show|No apps yet|No environments yet|Nothing has deployed|Never deployed here|No deploys yet)/,
		aggregates: ['app', 'environment'],
		readFirst: true
	}
];

/**
 * A control's `title` and `aria-label` are sentences a reader reaches, so
 * they are subject to the same property. `queryAllByText` cannot see them.
 *
 * The third tuple member is the claim's OWN text where that is an attribute
 * rather than the element's subtree — `resolveAxisAbove` needs it, because an
 * accessible name replaces the subtree for the person who hears it.
 */
export function claimBearingElements(
	container: HTMLElement,
	re: RegExp
): Array<[Element, string, string | undefined]> {
	const out: Array<[Element, string, string | undefined]> = [];
	for (const el of screen.queryAllByText(re))
		out.push([el, (el.textContent ?? '').trim(), undefined]);
	for (const el of Array.from(container.querySelectorAll('[title], [aria-label]'))) {
		for (const attr of ['title', 'aria-label']) {
			const v = el.getAttribute(attr);
			if (v && re.test(v.trim())) out.push([el, v.trim(), v.trim()]);
		}
	}
	return out;
}

export type AxisPlan = {
	/**
	 * Axes a row-level sentence must resolve. Anything in the region around
	 * it counts — the surface's `mustName`.
	 */
	row: Axis[];
	/**
	 * Axes a READ-FIRST sentence must resolve, and it may only resolve them
	 * from itself or from a header above it. This set is deliberately WIDER:
	 * only what the PAGE fixes is taken on trust, because `cardFixes` is a
	 * claim about a card, and a page-level banner is in no card. `/apps`
	 * declaring `cardFixes: ['app']` is what removed `app` from the checked
	 * set for the whole surface — the second, independent reason the banner
	 * defect shipped.
	 */
	readFirst: Axis[];
	/**
	 * ⭐ PER-SURFACE AGGREGATE OVERRIDES, because `N of M` counts a different
	 * SET on different pages and the claim table cannot know which.
	 *
	 * `0 of 3 on the newest` inside an app card on `/apps` counts ENVIRONMENTS;
	 * the identical string in the `How it's going` card on `/envs/<name>`
	 * counts APPS. Demanding that the second name an app is demanding a
	 * different sentence, exactly as `Claim.aggregates` says. Recording it
	 * here rather than widening the claim keeps the claim strong on every
	 * surface that did not ask for the exception, and makes each exception a
	 * line somebody signed.
	 */
	aggregates?: Partial<Record<string, Axis[]>>;
};

export type Violation = {
	claim: string;
	axis: Axis;
	readFirst: boolean;
	text: string;
	found: string[];
};

export function formatViolation(v: Violation): string {
	return (
		`  [${v.claim}]${v.readFirst ? ' (read first)' : ''} ${v.axis} unresolved\n` +
		`      sentence: ${JSON.stringify(v.text.slice(0, 160))}\n` +
		`      ${
			v.readFirst
				? 'nothing at or above it names that axis exactly once'
				: 'nearest region naming that axis holds'
		}: ${v.found.length ? v.found.join(', ') : '(nothing anywhere above it)'}`
	);
}

/** Every violation of the subject property on one rendered surface. */
export function subjectViolations(
	container: HTMLElement,
	axes: Axis[] | AxisPlan
): {
	violations: Violation[];
	checked: number;
} {
	const plan: AxisPlan = Array.isArray(axes) ? { row: axes, readFirst: axes } : axes;
	const violations: Violation[] = [];
	let checked = 0;
	for (const claim of CLAIMS) {
		const wanted = claim.readFirst ? plan.readFirst : plan.row;
		const aggregates = plan.aggregates?.[claim.id] ?? claim.aggregates;
		for (const [el, text, ownText] of claimBearingElements(container, claim.re)) {
			if (!text) continue;
			checked++;
			for (const axis of wanted) {
				if (aggregates?.includes(axis)) continue;
				const r = claim.readFirst
					? resolveAxisAbove(el, AXIS_VALUES[axis], ownText)
					: resolveAxis(el, AXIS_VALUES[axis]);
				if (r.resolved) continue;
				violations.push({
					claim: claim.id,
					axis,
					readFirst: !!claim.readFirst,
					text,
					found: r.found
				});
			}
		}
	}
	return { violations, checked };
}

/**
 * ── A VIOLATION SOMEBODY HAS LOOKED AT AND NOT YET DECIDED ───────────────
 *
 * The suite's existing convention for this is `test.skip('DECISION NEEDED:
 * …')` beside a passing test that encodes the status quo, so the open
 * question is visible in the run rather than absent from it. A whole surface
 * cannot be skipped that way -- skipping `/` would take twenty other claims
 * down with the one under discussion -- so a named exemption does the same
 * job at claim granularity.
 *
 * ⛔ AN EXEMPTION MUST STILL BE VIOLATED. `applyPending` fails when a listed
 * one no longer fires, because an exemption that has quietly become true is
 * an assertion nobody is making any more.
 */
export type Pending = { claim: string; axis: Axis; why: string };

export function applyPending(
	violations: Violation[],
	pending: Pending[]
): { open: Violation[]; stale: Pending[] } {
	const open: Violation[] = [];
	const hit = new Set<string>();
	for (const v of violations) {
		const p = pending.find((q) => q.claim === v.claim && q.axis === v.axis);
		if (p) {
			hit.add(`${p.claim}|${p.axis}`);
			continue;
		}
		open.push(v);
	}
	return { open, stale: pending.filter((p) => !hit.has(`${p.claim}|${p.axis}`)) };
}
