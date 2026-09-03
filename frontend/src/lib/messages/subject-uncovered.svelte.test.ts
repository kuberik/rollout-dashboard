/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

/**
 * PROPERTY 2, ON THE SURFACES THAT HAD NO RENDER TEST AT ALL.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 *
 * `subject.svelte.test.ts` covered five surfaces and `subject-detail`
 * covered three. Six more render operator sentences, and for those the only
 * guard was `drift.test.ts` — a CENSUS. A census notices that a string
 * appeared or changed. It cannot judge whether the string names its subject,
 * and accepting it is one `-u` away. That is exactly the gap through which
 * `/apps`'s banner shipped `DEV is waiting on another deploy` on a page
 * listing four apps: the string was catalogued, reviewed, and wrong.
 *
 * So: `/versions`, `/versions/<slug>`, `/namespaces/<name>`, `/dependencies`,
 * the command palette, and the two modals. The last three are not routes and
 * are the ones that matter most per pixel — a modal is the LAST SCREEN before
 * production changes, and the reader has by then left the page that named
 * what they are changing.
 *
 * `$app/state` is mocked here (hoisted per file, which is why this cannot
 * live in `subject.svelte.test.ts`), harmlessly for the surfaces that never
 * read it.
 */
const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/'),
		route: { id: null as string | null },
		status: 200,
		error: null,
		data: {},
		form: null,
		state: {}
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
import Versions from '../../routes/versions/+page.svelte';
import VersionDetail from '../../routes/versions/[...slug]/+page.svelte';
import Namespace from '../../routes/namespaces/[name]/+page.svelte';
import Dependencies from '../../routes/dependencies/+page.svelte';
import CommandPalette from '$lib/CommandPalette.svelte';
import ChangeVersionModal from '$lib/components/ChangeVersionModal.svelte';
import RecoveryModeWarningModal from '$lib/components/RecoveryModeWarningModal.svelte';
import { buildRevisionLedger } from '$lib/view-models/revision-ledger';
import { revisionPath } from '$lib/version-utils';
import { fleet, respond, APPS, TIERS } from './fleet-fixture';
import { SURFACES, AXES, type Axis } from './registry';
import { subjectViolations, formatViolation, applyPending, type Pending } from './axis';

/**
 * jsdom implements `<dialog>` as an element and not as a dialog: it has no
 * `showModal`, and `flowbite`'s `Dialog` calls it on mount. Without this the
 * two modals throw before rendering a node — which is exactly why neither had
 * a test.
 */
/**
 * `@xyflow/svelte` (the dependency graph) calls `Promise.withResolvers`, which
 * landed in Node 22. The repo's own dev setup note records this project
 * running on an older Node, and an unhandled rejection here fails the whole
 * vitest run rather than the one test.
 */
if (typeof (Promise as any).withResolvers !== 'function') {
	(Promise as any).withResolvers = function () {
		let resolve: (v?: unknown) => void = () => {};
		let reject: (e?: unknown) => void = () => {};
		const promise = new Promise((res, rej) => {
			resolve = res as typeof resolve;
			reject = rej;
		});
		return { promise, resolve, reject };
	};
}

if (!Element.prototype.animate) {
	// Svelte's `fly`/`fade` transitions call the Web Animations API, which
	// jsdom does not implement. A no-op that resolves immediately is enough:
	// the assertion is about the words, not the motion.
	Element.prototype.animate = function () {
		return {
			cancel() {},
			finish() {},
			set onfinish(_fn: unknown) {},
			currentTime: 0,
			playState: 'finished'
		} as unknown as Animation;
	};
}

if (!HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.show = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	state.page.params = {};
	state.page.url = new URL('http://localhost/');
});

/**
 * VIOLATIONS THAT FIRE AND ARE NOT YET DECIDED. Same contract as
 * `subject.svelte.test.ts`: listed so the rest of the surface stays under
 * test, and `applyPending` fails the moment one stops firing.
 */
const PENDING: Record<string, Pending[]> = {};

const competing = (a: Axis) => a !== 'version' && a !== 'cluster';

function plan(route: string) {
	const spec = SURFACES.find((s) => s.route === route)!;
	return {
		spec,
		row: spec.mustName.filter(competing),
		readFirst: AXES.filter((a) => !spec.pageFixes.includes(a)).filter(competing)
	};
}

/** Assert the subject property over one already-rendered surface. */
function assertSubject(
	route: string,
	container: HTMLElement,
	opts: { expectClaims?: boolean } = {}
) {
	const p = plan(route);
	const all = subjectViolations(container, {
		row: p.row,
		readFirst: p.readFirst,
		aggregates: p.spec.aggregates
	});
	const { open, stale } = applyPending(all.violations, PENDING[route] ?? []);
	if (stale.length > 0) {
		throw new Error(
			`${route} lists ${stale.length} pending exemption(s) that no longer fire:\n` +
				stale.map((q) => `  [${q.claim}] ${q.axis}\n      ${q.why}`).join('\n')
		);
	}
	if (open.length > 0) {
		throw new Error(
			`${route} renders ${open.length} claim(s) whose subject the surface does not fix.\n\n` +
				open.map(formatViolation).join('\n') +
				`\n\n  This surface fixes ${p.spec.pageFixes.concat(p.spec.cardFixes).join(', ') || 'nothing'}.\n` +
				`  ${p.spec.why}\n` +
				`  Row-level claims must supply ${p.row.join(' and ') || '(nothing)'}; a claim marked\n` +
				`  (read first) must supply ${p.readFirst.join(' and ') || '(nothing)'} from ITSELF or from a\n` +
				`  header ABOVE it — never from its own body or its own button.\n`
		);
	}
	if (opts.expectClaims)
		expect(all.checked, `${route} rendered none of the claims under test`).toBeGreaterThan(0);
	return all.checked;
}

const payload = () => fleet(() => ({ hold: 'approval' }));

async function mount(Comp: unknown, params: Record<string, string> = {}, url?: string) {
	state.page.params = params;
	if (url) state.page.url = new URL(`http://localhost${url}`);
	vi.stubGlobal('fetch', vi.fn(respond(payload())));
	return render(WithQueryClient, { props: { component: Comp as any } });
}

// ═════════════════════════════════════════════════════════════════════════
// The four routes
// ═════════════════════════════════════════════════════════════════════════

describe('the surfaces that had no render test name their subjects too', () => {
	test('/versions', async () => {
		const { container } = await mount(Versions);
		await waitFor(() => expect(screen.getAllByText(/r3ccccc|r1aaaaa/i).length).toBeGreaterThan(0), {
			timeout: 5000
		});
		assertSubject('/versions', container);
	});

	test('/versions/[...slug]', async () => {
		// The slug is DERIVED from the fixture rather than hard-coded, so a
		// change to how a revision addresses itself fails here loudly instead
		// of quietly rendering the 404 branch and asserting nothing.
		const p = payload();
		const ledgers = buildRevisionLedger(p.rollouts.items as any, p.environments.items as any);
		expect(ledgers.length, 'the fixture produced no revision ledger to open').toBeGreaterThan(0);
		const ledger = ledgers[0];
		expect(ledger.rows.length, 'the fixture ledger has no revisions').toBeGreaterThan(0);
		const path = revisionPath(ledger.repoKey, ledger.rows[0].revision);
		const slug = path.replace(/^\/versions\//, '');

		const { container } = await mount(VersionDetail, { slug }, path);
		await waitFor(
			() => expect(screen.getAllByText(/alpha-app|r1aaaaa|r3ccccc/i).length).toBeGreaterThan(0),
			{ timeout: 5000 }
		);
		expect(
			container.textContent,
			'the slug resolved to the not-found branch; the test would then assert nothing'
		).not.toMatch(/Revision not found/);
		assertSubject('/versions/[...slug]', container);
	});

	test('/namespaces/[name]', async () => {
		const { container } = await mount(Namespace, { name: 'alpha-dev' });
		await waitFor(() => expect(screen.getAllByText(/alpha-app/i).length).toBeGreaterThan(0), {
			timeout: 5000
		});
		assertSubject('/namespaces/[name]', container);
	});

	/**
	 * ⛔ THE FIXTURE HAD TO GROW A DEPENDENCY FOR THIS PAGE TO HAVE ANYTHING
	 * TO DRAW. `rolloutDependencies: { items: [] }` rendered the page's
	 * trivial branch and the test asserted the subject property over the word
	 * `Dependencies`. Same omission, same page, same reason the `upstream`
	 * headline was never rendered anywhere in this suite.
	 */
	test('/dependencies', async () => {
		state.page.params = {};
		vi.stubGlobal('fetch', vi.fn(respond(fleet(() => ({ hold: 'dependency' })))));
		const { container } = render(WithQueryClient, { props: { component: Dependencies as any } });
		await waitFor(() => expect(container.textContent).toMatch(/alpha-app/), { timeout: 5000 });
		expect(
			container.textContent,
			'the graph rendered its trivial branch -- the test would then assert nothing'
		).not.toMatch(/No rollout in this fleet is gated on another/);
		assertSubject('/dependencies', container);
	});
});

// ═════════════════════════════════════════════════════════════════════════
// The command palette — a flat list with no headers at all
// ═════════════════════════════════════════════════════════════════════════

describe('the command palette names what each row is', () => {
	function open() {
		const p = payload();
		return render(CommandPalette, {
			props: {
				open: true,
				scope: 'rollout',
				rollouts: p.rollouts.items as any,
				environments: p.environments.items as any,
				localClusterName: 'rollout-a'
			}
		});
	}

	test('every row names its app', async () => {
		const { container } = open();
		assertSubject('command palette', container);
	});

	/**
	 * ⛔ THE PALETTE IS THE ONE SURFACE WITH NO HEADERS AT ALL, so a row that
	 * omits an axis has nothing anywhere to borrow it from. The fixture puts
	 * `alpha-app` in three namespaces on one cluster and `beta-app` in three
	 * on another; six rows, and the only thing telling them apart is what each
	 * row prints.
	 */
	test('six competing rows are six distinguishable rows', () => {
		const { container } = open();
		const rows = Array.from(container.querySelectorAll('[data-idx]')).map((r) =>
			(r.textContent ?? '').replace(/\s+/g, ' ').trim()
		);
		expect(rows.length).toBe(APPS.length * TIERS.length);
		expect(
			new Set(rows).size,
			`the palette draws ${rows.length} rows and only ${new Set(rows).size} distinct strings:\n  ` +
				rows.join('\n  ')
		).toBe(rows.length);
		for (const r of rows) {
			expect(
				APPS.some((a) => r.includes(a)),
				`a palette row reads ${JSON.stringify(r)} and names no app`
			).toBe(true);
		}
	});
});

// ═════════════════════════════════════════════════════════════════════════
// The modals — the last screen before production changes
// ═════════════════════════════════════════════════════════════════════════

/**
 * ⭐ A MODAL FIXES ITS AXES ONLY IF IT SAYS SO.
 *
 * `registry.ts` used to record `pageFixes: ['app','environment','cluster']`
 * for both of these, on the reasoning that a modal is handed one rollout and
 * is therefore ABOUT one thing. That reasoning is the `/apps` banner defect
 * restated: ABOUT-NESS IS NOT NAMING. The modal is the last screen before
 * production changes, the page behind it is inert, and on a 390px phone it is
 * the only object on screen — so an axis it does not print is an axis that is
 * not on screen at all.
 *
 * Measured, both are worse than the registry claimed, and the registry now
 * says what they actually do.
 */
describe('a modal states what it is about to change', () => {
	const p = payload();
	const rollout = p.rollouts.items[0] as any; // alpha-app / alpha-dev / rollout-a

	function openChangeVersion() {
		vi.stubGlobal('fetch', vi.fn(respond(p)));
		render(WithQueryClient, {
			props: {
				component: ChangeVersionModal as any,
				props: {
					open: true,
					rollout,
					cluster: 'rollout-a',
					environmentName: 'alpha-app-dev'
				}
			}
		});
		return () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
	}

	function openRecovery() {
		render(RecoveryModeWarningModal, {
			props: {
				open: true,
				reason: 'previous-failed',
				versionDisplay: 'r3ccccc',
				onContinue: () => {}
			}
		});
		return () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
	}

	test('change-version names the rollout it will deploy', async () => {
		const text = openChangeVersion();
		await waitFor(() => expect(text()).toMatch(/Deploy|Version/i), { timeout: 5000 });
		expect(
			/alpha-app/.test(text()),
			`the change-version modal never prints the rollout it is about to change. It reads:\n  ${text().slice(0, 400)}`
		).toBe(true);
		assertSubject('modal: change version', document.body as HTMLElement);
	});

	/**
	 * ⭐ RESOLVED. (operator walk, 2026-09-03) This was
	 * `test.skip('DECISION NEEDED: …')` plus a companion "status quo" tripwire
	 * that failed the moment the modal started naming its environment or
	 * cluster — which is exactly what the fix below does, so the tripwire did
	 * its job and is deleted rather than left permanently red. The header now
	 * reads `Change Version / alpha-app · ALPHA-APP-DEV · rollout-a`
	 * (`envLabel`, uppercase, matches the chip vocabulary the rest of the
	 * product already uses for a tier — `ClearPinModal`'s title does the same
	 * derivation) — `/i` because the rendered word is uppercase and this
	 * regex predates that decision.
	 */
	test('the change-version modal names where it will deploy', async () => {
		const text = openChangeVersion();
		await waitFor(() => expect(text()).toMatch(/Deploy|Version/i), { timeout: 5000 });
		expect(text()).toMatch(/\balpha-dev\b|\bdev\b/i);
		expect(text()).toMatch(/rollout-a/);
	});

	test('the recovery warning renders', async () => {
		const text = openRecovery();
		await waitFor(() => expect(text()).toMatch(/Recovery|recovery/), { timeout: 5000 });
		assertSubject('modal: recovery warning', document.body as HTMLElement);
	});

	/**
	 * FAILING AND NAMED ON PURPOSE — A PRODUCT DECISION, AND THE WORST OF THE
	 * THREE SUBJECTS FOUND IN THIS PASS.
	 *
	 * `RecoveryModeWarningModal` takes `reason`, `versionDisplay` and
	 * `onContinue`. It is handed NO ROLLOUT, so it cannot name the app, the
	 * environment or the cluster even if it wanted to, and it does not. What
	 * it renders is:
	 *
	 *     Recovery deploy
	 *     Version r3ccccc
	 *     The previous deployment failed. Continuing will start a new
	 *     deployment in recovery mode.
	 *     In recovery mode: Health check failures will not mark this
	 *     deployment as failed …
	 *
	 * *Which* deployment. This is the dialog that turns OFF the signal that
	 * says a deploy went wrong, it is the last screen before that happens, and
	 * the only noun in it is a seven-character build tag that exists in every
	 * environment of every app. `/apps`'s banner at least named the tier.
	 *
	 * The fix is a prop and a line of markup, but it is a change to a
	 * safety-critical confirmation, so it is named here for the owner.
	 */
	test.skip('DECISION NEEDED: the recovery-mode warning names what it is about to deploy', async () => {
		const text = openRecovery();
		await waitFor(() => expect(text()).toMatch(/Recovery|recovery/), { timeout: 5000 });
		expect(APPS.some((a) => text().includes(a))).toBe(true);
	});

	test('the status quo, encoded so the decision above is visible and not silent', async () => {
		const text = openRecovery();
		await waitFor(() => expect(text()).toMatch(/Recovery|recovery/), { timeout: 5000 });
		expect(
			APPS.some((a) => text().includes(a)) ||
				TIERS.some((t) => new RegExp(`\\b${t}\\b`).test(text())),
			'the recovery modal started naming its subject — un-skip the test above'
		).toBe(false);
	});
});
