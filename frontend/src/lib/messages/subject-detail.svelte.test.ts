/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

/**
 * PROPERTY 2, ON THE PAGES THAT FIX AN AXIS BY BEING ABOUT ONE THING.
 *
 * These three surfaces are the CONTROL for the list surfaces: the sentences
 * are identical, and here they are exact. That is the whole shape of the
 * finding -- `DEV is waiting on an approval` is a correct sentence on rollout
 * detail and an incomplete one on `/environments`, and no amount of reading
 * the string tells you which.
 *
 * They are in their own file because they need `$app/state`, and `vi.mock` is
 * hoisted per file.
 */
const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/'),
		route: { id: null as string | null },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import AppDetail from '../../routes/apps/[name]/+page.svelte';
import EnvDetail from '../../routes/envs/[name]/+page.svelte';
import RolloutDetail from '../../routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte';
import { fleet, respond } from './fleet-fixture';
import { SURFACES, AXES, type Axis } from './registry';
import { subjectViolations, formatViolation } from './axis';

afterEach(() => vi.unstubAllGlobals());

async function mount(Comp: unknown, params: Record<string, string>, fetcher?: any) {
	state.page.params = params;
	const payload = fleet();
	vi.stubGlobal('fetch', vi.fn(fetcher ?? respond(payload)));
	const r = render(WithQueryClient, { props: { component: Comp as any } });
	await waitFor(() => expect(screen.getAllByText(/alpha-app|r1aaaaa/i).length).toBeGreaterThan(0), {
		timeout: 5000
	});
	return r;
}

/** The single-rollout endpoint answers with one rollout; everything else is the list. */
function detailFetch() {
	const payload = fleet();
	const one = payload.rollouts.items[0];
	const env = payload.environments.items[0];
	const list = respond(payload) as any;
	return async (input: any) => {
		const url = String(typeof input === 'string' ? input : (input?.url ?? input));
		if (/\/api\/rollouts\/[^/]+\/[^/]+(\?|$)/.test(url)) {
			return new Response(
				JSON.stringify({ rollout: one, environment: env, rolloutGates: { items: [] } }),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		}
		return list(input);
	};
}

const CASES: Array<{
	route: string;
	Comp: unknown;
	params: Record<string, string>;
	fetcher?: any;
}> = [
	{ route: '/apps/[name]', Comp: AppDetail, params: { name: 'alpha-app' } },
	{ route: '/envs/[name]', Comp: EnvDetail, params: { name: 'dev' } },
	{
		route: '/rollouts/[cluster]/[namespace]/[name]',
		Comp: RolloutDetail,
		params: { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' },
		fetcher: detailFetch()
	}
];

describe('a page that is about one thing fixes that axis, and still names the rest', () => {
	for (const c of CASES) {
		const spec = SURFACES.find((s) => s.route === c.route)!;
		const competing = (a: Axis) => a !== 'version' && a !== 'cluster';
		const axes = spec.mustName.filter(competing);
		// Same split as the list surfaces: a read-first sentence takes only
		// what the PAGE fixes on trust. On these three that is most of it,
		// which is the point -- they are the control.
		const headlineAxes = AXES.filter((a) => !spec.pageFixes.includes(a)).filter(competing);

		test(`${c.route} — ${axes.length ? axes.join(' + ') + ' named on every claim' : 'every axis fixed by the page'}`, async () => {
			const { container } = await mount(c.Comp, c.params, c.fetcher);
			const found = subjectViolations(container, {
				row: axes,
				readFirst: headlineAxes,
				aggregates: spec.aggregates
			});
			const checked = found.checked;
			const violations = found.violations.map(formatViolation);
			if (violations.length > 0) {
				throw new Error(
					`${c.route} renders ${violations.length} claim(s) whose subject the page does not fix.\n\n` +
						violations.join('\n') +
						`\n\n  ${spec.why}\n`
				);
			}
			expect(checked, `${c.route} rendered none of the claims under test`).toBeGreaterThan(0);
		});
	}

	/**
	 * The header is what makes every other sentence on rollout detail
	 * unambiguous. If it stops naming all three, every sentence below it
	 * silently loses its subject and this file's other cases still pass.
	 */
	test('rollout detail names its app, its environment and its cluster in the route it was asked for', async () => {
		await mount(
			RolloutDetail,
			{ cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' },
			detailFetch()
		);
		expect(screen.getAllByText(/alpha-app/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/\bdev\b/i).length).toBeGreaterThan(0);
	});
});

/**
 * ONE PAGE MAY NOT ANSWER ITS OWN QUESTION TWICE.
 *
 * `/apps/<name>`'s banner said *"Unchanged for 28d and nothing is holding it
 * on purpose"* while the environment row 60px below it said *"Waiting for
 * someone to approve it — This will not clear on its own"*. `stuck` and
 * `blocked` are independent facts and the banner had only been told about the
 * first, so the loudest object on the page carried the claim from absence.
 */
describe('the app page does not contradict its own rows', () => {
	test('it never says nothing is holding an environment that a gate is holding', async () => {
		const { container } = await mount(AppDetail, { name: 'alpha-app' });
		const text = (container.textContent ?? '').replace(/\s+/g, ' ');
		const claimsNothingHolds = /nothing is holding it on purpose/.test(text);
		const namesAHold =
			/Waiting for someone to approve it|Nothing promotes itself until|Held by /.test(text);
		expect(
			claimsNothingHolds && namesAHold,
			`the banner says nothing is holding it while a row on the same page names the hold:\n  ${text.slice(0, 400)}`
		).toBe(false);
	});
});

/**
 * ONE ROLLOUT, TWO SURFACES, ONE ANSWER. This is the 3am question and the
 * finding that opened the first critique: `/apps/<name>` said the hold would
 * never clear while rollout detail said it cleared at 1:00 PM.
 */
describe('rollout detail and the app page give the same answer about one rollout', () => {
	test('both say a person is needed, or neither does', async () => {
		const { container: appPage, unmount } = await mount(AppDetail, { name: 'alpha-app' });
		const appText = (appPage.textContent ?? '').replace(/\s+/g, ' ');
		unmount();
		vi.unstubAllGlobals();

		const { container: detail } = await mount(
			RolloutDetail,
			{ cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' },
			detailFetch()
		);
		const detailText = (detail.textContent ?? '').replace(/\s+/g, ' ');

		const escalates = (t: string) => /This will not clear on its own/.test(t);
		const selfClears = (t: string) => /clears on its own|Nobody has to approve anything/.test(t);

		expect(
			escalates(appText),
			'the app page and rollout detail disagree about whether a person is needed'
		).toBe(escalates(detailText));
		expect(selfClears(appText)).toBe(selfClears(detailText));
	});
});
