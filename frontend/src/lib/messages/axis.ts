/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * THE SUBJECT PROPERTY, AS A FUNCTION OF THE DOM.
 *
 * Shared by `subject.svelte.test.ts` (the list surfaces) and
 * `subject-detail.svelte.test.ts` (the pages that fix an axis by being about
 * one thing), so the two cannot drift into two definitions of "unambiguous".
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

export type Claim = { id: string; re: RegExp; aggregates?: Axis[] };

/**
 * THE CLAIMS UNDER TEST -- patterns, not literals, so a rewording is still
 * caught by the same case.
 *
 * `aggregates` names an axis a claim deliberately spans. `0 of 3 up to date`
 * is ABOUT three environments; demanding that it name one would be demanding
 * a different sentence.
 */
export const CLAIMS: Claim[] = [
	{
		id: 'blocking headline',
		re: /\b(is waiting on an approval|is waiting on another deploy|things are holding|Something is holding)\b/
	},
	{ id: 'blocking consequence', re: /Nothing promotes itself until/ },
	{
		id: 'blocking verdict',
		re: /(This will not clear on its own|Nobody has to approve anything|cannot tell what clears this)/
	},
	{
		id: 'blocking row',
		re: /^(Waiting for [a-z]|Held by |Outside the |A check is not passing|Waiting for someone to approve it|No newer version is allowed yet|Waiting on a check or a time window)/
	},
	{ id: 'rank title', re: /can still take \d+ newer version/ },
	{
		id: 'deploy state word',
		re: /^(deploy succeeded|deploy failed|checking|deploying|stopped|no deploy yet)$/
	},
	{ id: 'health failure title', re: /Health check .* is failing/ },
	{ id: 'pin', re: /is pinned to|Held on .* on purpose/ },
	{ id: 'stuck banner', re: /is stuck$|Unchanged for /, aggregates: [] },
	{
		id: 'up-to-date headline',
		re: /^(All up to date|Never deployed|\d+ of \d+ up to date)$/,
		aggregates: ['environment']
	}
];

/**
 * A control's `title` and `aria-label` are sentences a reader reaches, so
 * they are subject to the same property. `queryAllByText` cannot see them.
 */
export function claimBearingElements(
	container: HTMLElement,
	re: RegExp
): Array<[Element, string]> {
	const out: Array<[Element, string]> = [];
	for (const el of screen.queryAllByText(re)) out.push([el, (el.textContent ?? '').trim()]);
	for (const el of Array.from(container.querySelectorAll('[title], [aria-label]'))) {
		for (const attr of ['title', 'aria-label']) {
			const v = el.getAttribute(attr);
			if (v && re.test(v.trim())) out.push([el, v.trim()]);
		}
	}
	return out;
}

/** Every violation of the subject property on one rendered surface. */
export function subjectViolations(container: HTMLElement, axes: Axis[]): {
	violations: string[];
	checked: number;
} {
	const violations: string[] = [];
	let checked = 0;
	for (const claim of CLAIMS) {
		for (const [el, text] of claimBearingElements(container, claim.re)) {
			if (!text) continue;
			checked++;
			for (const axis of axes) {
				if (claim.aggregates?.includes(axis)) continue;
				const r = resolveAxis(el, AXIS_VALUES[axis]);
				if (r.resolved) continue;
				violations.push(
					`  [${claim.id}] ${axis} unresolved\n` +
						`      sentence: ${JSON.stringify(text.slice(0, 160))}\n` +
						`      nearest region naming that axis holds: ${r.found.length ? r.found.join(', ') : '(nothing anywhere above it)'}`
				);
			}
		}
	}
	return { violations, checked };
}
